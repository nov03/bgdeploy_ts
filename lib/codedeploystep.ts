import { CodePipelineActionFactoryResult, FileSet, ICodePipelineActionFactory, ProduceActionOptions, Step } from 'aws-cdk-lib/pipelines';
import { IStage } from 'aws-cdk-lib/aws-codepipeline';
import { IEcsDeploymentGroup } from 'aws-cdk-lib/aws-codedeploy';
import { CodeDeployEcsDeployAction } from 'aws-cdk-lib/aws-codepipeline-actions';

export class CodeDeployStep extends Step implements ICodePipelineActionFactory {
    fileSet: FileSet;
    deploymentGroup: IEcsDeploymentGroup;
    envType: string;

    constructor(id: string, fileSet: FileSet, deploymentGroup: IEcsDeploymentGroup, stageName: string) {
        super(id);
        this.fileSet = fileSet;
        this.deploymentGroup = deploymentGroup;
        this.envType = stageName;
    }

    produceAction(stage: IStage, options: ProduceActionOptions): CodePipelineActionFactoryResult {
        const artifact = options.artifacts.toCodePipeline(this.fileSet);

        const containerImageInput = {
            input: artifact,
            taskDefinitionPlaceholder: "IMAGE1_NAME"
        };

        stage.addAction(new CodeDeployEcsDeployAction({
            actionName: "Deploy",
            appSpecTemplateInput: artifact,
            taskDefinitionTemplateInput: artifact,
            runOrder: options.runOrder,
            containerImageInputs: [containerImageInput],
            deploymentGroup: this.deploymentGroup,
            variablesNamespace: `deployment-${this.envType}`
        }));

        return { runOrdersConsumed: 1 };
    }
}
