import { Stack, StackProps, Environment,Stage  } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
    aws_codecommit as codecommit,
    pipelines as pipelines,
    aws_codedeploy as codedeploy,
    aws_codebuild as codebuild,
    aws_ecr as ecr,
    aws_iam as iam

} from "aws-cdk-lib";
import { Constants } from './constants';
import { Service } from './service';
import { CodeDeployStep } from './codedeploystep'
import { EcsApplication, EcsDeploymentGroup } from 'aws-cdk-lib/aws-codedeploy';
import * as cdk from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface ToolchainProps extends StackProps {
    gitRepoURL: string;
    gitBranch: string;
    stages: {
        name: string;
        deploymentConfig: codedeploy.IEcsDeploymentConfig;
        env: Environment;
    }[];
}

export class Toolchain extends Stack {
    private pipeline: pipelines.CodePipeline;
    private readonly toolchainProperty: ToolchainProps; 

    constructor(scope: Construct, id: string, props: ToolchainProps) {
        super(scope, id, props);
        this.toolchainProperty = props; // propsをToolchainクラスのプロパティに設定

        //パイプラインを生成しステージを追加
        this.pipeline = this.createPipeline(props.gitRepoURL, props.gitBranch);
        for (const stage of props.stages) {
            this.addPipelineStage(stage.name, stage.deploymentConfig, stage.env );
        }
    }


    private referenceCodeDeployDeploymentGroup(
        env: cdk.Environment, 
        serviceName: string, 
        ecsDeploymentConfig: codedeploy.IEcsDeploymentConfig,
        stageName: string
      ): codedeploy.IEcsDeploymentGroup {
    
        const codeDeployApp = EcsApplication.fromEcsApplicationArn(
            this,
            `EcsCodeDeployApp-${stageName}`,
            cdk.Arn.format({
                arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
                partition: "aws",
                region: env.region,
                service: "codedeploy",
                account: env.account,
                resource: "application",
                resourceName: serviceName
            })
        );
    
        const deploymentGroup = EcsDeploymentGroup.fromEcsDeploymentGroupAttributes(
            this,
            `-EcsCodeDeployDG-${stageName}`,
            {
                deploymentGroupName: serviceName,
                application: codeDeployApp,
                deploymentConfig: ecsDeploymentConfig
            }
        );
    
        return deploymentGroup;
      }



    private createPipeline(repoURL: string, branch: string): pipelines.CodePipeline {
        const source = new codecommit.Repository(this, `EcsTutorialRepo`, {
            repositoryName: "ecs-tutorial-repo-test",
          });

        return new pipelines.CodePipeline(this, `Pipeline-${Constants.APP_NAME}`, {
            publishAssetsInParallel: false,
            dockerEnabledForSelfMutation: true,
            crossAccountKeys: true,
            synth: new pipelines.ShellStep(`${Constants.APP_NAME}-synth`, {
                input: pipelines.CodePipelineSource.codeCommit(source, this.toolchainProperty.gitBranch),
                installCommands: ["npm install"],
                commands: [
                    "npm run build",
                    "npx cdk synth",
                    "cp -r lib/codebuild cdk.out/",
                    "cp -r lib/codedeploy cdk.out/"
                ],
            })
        });
    }

    private grantUpdatePipelineCrossAccountPermissions(stageNameEnvironment: Map<string, Environment>) {
        if (stageNameEnvironment.size > 0) {
            for (const [stage, env] of stageNameEnvironment.entries()) {
                const condition = {
                    "ForAnyValue:StringEquals": {
                        "iam:ResourceTag/aws-cdk:bootstrap-role": ["file-publishing", "deploy"]
                    }
                };

                this.pipeline.selfMutationProject.role?.addToPrincipalPolicy(new PolicyStatement({
                    actions: ["sts:AssumeRole"],
                    effect: Effect.ALLOW,
                    resources: [`arn:*:iam::${env.account}:role/*`],
                    conditions: condition
                }));
            }
        }
    }

    private addPipelineStage(stageName: string, ecsDeploymentConfig: codedeploy.IEcsDeploymentConfig, env: Environment ): Toolchain {
        const stage = new Stage(this.pipeline, stageName, { env: env });
        const SERVICE_NAME = `${Constants.APP_NAME}Service-${stageName}`;

        new Service(stage, SERVICE_NAME, {
            ecsDeploymentConfig: ecsDeploymentConfig,
            stackName: SERVICE_NAME,
            description: SERVICE_NAME,
            env: env ,
            pipelineAccount: this.toolchainProperty.env!
        });
        

        const stageDeployment = this.pipeline.addStage(stage);

        // ECRのアクセス権限を追加
        // IAMロールの作成
        const buildRole = new iam.Role(this, 'BuildRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
        });
        // 既存のECRリポジトリを参照
        const ecrepo = ecr.Repository.fromRepositoryName(this, 'ExistingRepo', 'ecs-tutorial'); // リポジトリ名を適切に置き換えてください。
        ecrepo.grantPullPush(buildRole)


        const dockerBuildStep = new pipelines.CodeBuildStep('DockerBuildStep', {
            buildEnvironment: {
              buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
              privileged: true,
            },
            role: buildRole,
            input: this.pipeline.synth.primaryOutput,
            commands: [
              "ls -l; pwd",
              "cd codebuild",
              'chmod +x build.sh',
              './build.sh',  
            ],
            
            primaryOutputDirectory: 'codebuild/',  // 出力ディレクトリを指定します。
            env: {
              'AWS_REGION_NAME': 'ap-northeast-1',
              'ECR_REPOSITORY_NAME': 'ecs-tutorial',
            }
          });
        const configureCodeDeployStep = new pipelines.ShellStep("ConfigureBlueGreenDeploy", {
            input: this.pipeline.cloudAssemblyFileSet,
            additionalInputs: {
              'dockerOutput': dockerBuildStep.primaryOutput!
            },
            primaryOutputDirectory: 'codedeploy',
            commands: [
              "ls -l",
              "pwd",
              "ls -l dockerOutput/",
              "ls -l codebuild/",
              "cp dockerOutput/imageDetail.json codedeploy/",
              "cd codedeploy",
              "chmod a+x codedeploy_configuration.sh",
              "./codedeploy_configuration.sh"
            ],
            env: {
              'TASK_EXEC_ROLE': `tutorialEcsExecutionRole`,
              'APPLICATION': 'crossAccountEcsBGDeployApp',
              'FARGATE_TASK_DEFINITION': 'crossAccountEcsBGDeployDef'
            }
        });
        const deployStep = new CodeDeployStep(
            `codeDeploy`,
            configureCodeDeployStep.primaryOutput!,
            this.referenceCodeDeployDeploymentGroup(env, "crossAccountEcsBGDeployApp", ecsDeploymentConfig, stageName),
            stageName
        );
      
        // dockerBuildStep をステージに追加
        stageDeployment.addPre(dockerBuildStep);

        // configureCodeDeployStep と deployStep を dockerBuildStep の後に追加
        deployStep.addStepDependency(configureCodeDeployStep);
        stageDeployment.addPost(configureCodeDeployStep, deployStep);

        // selfMutationProject.roleにポリシーをアタッチするためパイプラインを初期化
        this.pipeline.buildPipeline();

        
        const crossAccountEnvironments = new Map<string, Environment>();
        const pipelineAccount = this.account; // パイプラインのアカウントを取得
        for (const stage of this.toolchainProperty.stages) {
            if (pipelineAccount !== stage.env.account) { // パイプラインのアカウントとステージのアカウントが異なる場合
                crossAccountEnvironments.set(stage.name, stage.env);
            }
        }
        this.grantUpdatePipelineCrossAccountPermissions(crossAccountEnvironments);
        return this;
    }

}