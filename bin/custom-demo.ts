import { App, Environment, StackProps } from 'aws-cdk-lib';
import { EcsDeploymentConfig } from 'aws-cdk-lib/aws-codedeploy';
import { Toolchain } from '../lib/toolchain';
import { Constants } from '../lib/constants';


class Demo {
    // パイプラインを構成するアカウント(TOOLCHAIN_ACCOUNT)を指定
    private static readonly TOOLCHAIN_ACCOUNT = 'XXXXXXXX';
    private static readonly TOOLCHAIN_REGION = 'ap-northeast-1';
    // CodeCommit account is the same as the toolchain account
    public static readonly CODECOMMIT_REPO = Constants.APP_NAME;
    public static readonly CODECOMMIT_BRANCH = 'main';
    // ECSが稼働するアカウント(SERVICE_ACCOUNT)を指定
    public static readonly SERVICE_ACCOUNT = 'YYYYYYYYY';
    public static readonly SERVICE_REGION = Demo.TOOLCHAIN_REGION;

    public static main() {
        const app = new App();

        new Toolchain(app, `${Constants.APP_NAME}Toolchain-custom`, {
            env: {
                account: Demo.TOOLCHAIN_ACCOUNT,
                region: Demo.TOOLCHAIN_REGION
            },
            gitRepoURL: Demo.CODECOMMIT_REPO,
            gitBranch: Demo.CODECOMMIT_BRANCH,
            stages: [{
                name: 'UAT',
                deploymentConfig: EcsDeploymentConfig.CANARY_10PERCENT_5MINUTES,
                env: {
                    account: Demo.SERVICE_ACCOUNT,
                    region: Demo.SERVICE_REGION
                }
            }]
        });

        app.synth();
    }
}


Demo.main();
