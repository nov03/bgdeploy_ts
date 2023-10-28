import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import {
    aws_ec2 as ec2,
    aws_elasticloadbalancingv2 as elbv2,
    aws_codedeploy as codedeploy,
    aws_ecs as ecs,
    aws_ecr as ecr,
    aws_iam as iam
  } from "aws-cdk-lib";


interface ServiceProps extends StackProps {
    ecsDeploymentConfig: codedeploy.IEcsDeploymentConfig;
    stackName: string;
    description: string;
    pipelineAccount: cdk.Environment; 
}

export class Service extends Stack {
    constructor(scope: Construct, id: string, props: ServiceProps) {
        // ServicePropsからStackPropsの部分のみを抽出してsuperに渡す
        super(scope, id, {
            env: props.env,
            stackName: props.stackName,
            description: props.description,
        });

        // VPCの作成
        const vpc = new ec2.Vpc(this, 'MyVPC', {
            maxAzs: 2,
            subnetConfiguration: [
            {
                subnetType: ec2.SubnetType.PUBLIC,
                name: 'MyPublicSubnet',
                cidrMask: 24
            },
            {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                name: 'MyPrivateSubnet',
                cidrMask: 24
            }
            ]
        });

        // セキュリティグループの作成
        const securityGroup = new ec2.SecurityGroup(this, 'MySecurityGroup', {
            vpc: vpc,
            description: 'Allow all outbound traffic by default',
            allowAllOutbound: true // すべてのアウトバウンドトラフィックを許可（デフォルト）
        });

        // インバウンドルールの追加例 (80番ポートを許可する)
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'allow SSH access from the world');
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'allow access to test listener');



        // Application Load Balancerの作成
        const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'BlueGreenALB', {
            vpc: vpc,
            internetFacing: true, // 公開向け
            loadBalancerName: 'bluegreen-alb',
            securityGroup: securityGroup, // 既に作成したセキュリティグループを使用
        });


        // Target Groupの作成
        const targetGroupBlue = new elbv2.ApplicationTargetGroup(this, 'BlueTarget', {
            vpc: vpc,
            protocol: elbv2.ApplicationProtocol.HTTP,
            port: 80,
            targetType: elbv2.TargetType.IP,
            targetGroupName: "BlueTarget",
        });
        const targetGroupGreen = new elbv2.ApplicationTargetGroup(this, 'GreenTarget', {
            vpc: vpc,
            protocol: elbv2.ApplicationProtocol.HTTP,
            port: 80,
            targetType: elbv2.TargetType.IP,
            targetGroupName: "GreenTarget",
        });
        
        // ALBにHTTPリスナーを追加して、トラフィックをTarget Groupに転送する
        const bglistener = loadBalancer.addListener('ListenerGreen', {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            defaultAction: elbv2.ListenerAction.forward([targetGroupBlue]),
        });

        // テスト用のリスナーを追加する
        const testListener = loadBalancer.addListener('TestListener', {
            port: 8080, // 8080というテストポートを使用します。必要に応じて変更できます。
            protocol: elbv2.ApplicationProtocol.HTTP,
            defaultAction: elbv2.ListenerAction.forward([targetGroupGreen]), // Greenのターゲットグループに転送
        });


        // ECSクラスタの作成
        const cluster = new ecs.Cluster(this, 'BlueGreenCluster', {
            clusterName: 'tutorial-bluegreen-cluster',
            vpc: vpc,
        });

        // タスク実行ロールの作成
        // パイプラインアカウントにてタスク定義ファイルに実行ロール名を指定する必要があるため、実行ロール名は自動生成名ではなくロール名を明示的に指定する。
        const executionRole = new iam.Role(this, 'ExecutionRole', {
            roleName: "tutorialEcsExecutionRole",
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });

        // ECR へのアクセスを許可するポリシーをロールにアタッチ
        executionRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                "ecr:GetAuthorizationToken", 
                "ecr:BatchCheckLayerAvailability", 
                "ecr:GetDownloadUrlForLayer", 
                "ecr:BatchGetImage"
            ],
            resources: ["*"],
        }));

        // タスクロールの作成
        const taskRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });

        // タスクロールに必要な権限を追加（例：S3へのアクセスなど）
        // この例ではS3の全てのバケットへの読み取り権限を追加していますが、実際の要件に合わせて調整してください。
        taskRole.addToPolicy(new iam.PolicyStatement({
            actions: ["s3:GetObject"],
            resources: ["arn:aws:s3:::*/*"],
        }));

        // ECSタスク定義の作成
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'TutorialTaskDef', {
            memoryLimitMiB: 512,
            cpu: 256,
            executionRole: executionRole,
            taskRole: taskRole,  // ここでタスクロールを指定
            family: 'crossAccountEcsBGDeployDef'
        });

        // ECRリポジトリからコンテナイメージを取得。ecs-tutorialという名前のリポジトリで指定
        const containerImage = ecs.ContainerImage.fromRegistry(
            `${props.pipelineAccount.account}.dkr.ecr.ap-northeast-1.amazonaws.com/ecs-tutorial:latest`
        );


        const container = taskDefinition.addContainer('sample-app', {
            image: containerImage,
            memoryLimitMiB: 512,
            essential: true,
        });

        container.addPortMappings({
            containerPort: 80
        });

        // ECSサービスの作成（Fargateサービス）
        const ecsFargateService = new ecs.FargateService(this, 'FargateService', {
            cluster: cluster,
            serviceName: "crossAccountEcsBGDeploy",
            taskDefinition: taskDefinition,
            desiredCount: 2,
            assignPublicIp: true,
            securityGroups: [securityGroup],
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
            deploymentController: {
                type: ecs.DeploymentControllerType.CODE_DEPLOY,
            },
            platformVersion: ecs.FargatePlatformVersion.LATEST,
        });


        // タスクをTarget Groupに関連付け
        targetGroupBlue.addTarget(ecsFargateService);


        // CodeDeployの定義
        const application = new codedeploy.EcsApplication(this, 'BlueGreenApp', {
            applicationName: 'crossAccountEcsBGDeployApp',
        });

        // IAM Roleの作成
        const ecsCodeDeployRole = new iam.Role(this, 'EcsCodeDeployRole', {
            assumedBy: new iam.ServicePrincipal('codedeploy.amazonaws.com'),
        });
        // デプロイグループの作成
        new codedeploy.EcsDeploymentGroup(this, 'BlueGreenDG', {
            application: application,
            deploymentGroupName: "crossAccountEcsBGDeployApp",
            service: ecsFargateService,  
            deploymentConfig: props.ecsDeploymentConfig,
            blueGreenDeploymentConfig: {
                blueTargetGroup: targetGroupBlue,
                greenTargetGroup: targetGroupGreen,
                listener: bglistener,
                testListener: testListener, 
                deploymentApprovalWaitTime: cdk.Duration.minutes(30),  // Greenへの切り替わりを30分待機
                terminationWaitTime: cdk.Duration.minutes(10) // 新しいタスクの開始後、古いタスクの停止までの待機時間
            },
            role: ecsCodeDeployRole,
        });
        
        // CodeDeployのアプリケーションとデプロイグループの参照
        const app = codedeploy.ServerApplication.fromServerApplicationName(this, 'ExistingApp', 'crossAccountEcsBGDeployApp');
        const deploymentGroup = codedeploy.ServerDeploymentGroup.fromServerDeploymentGroupAttributes(this, 'ExistingDG', {
            application: app,
            deploymentGroupName: 'crossAccountEcsBGDeployApp',
        });

    }
}
