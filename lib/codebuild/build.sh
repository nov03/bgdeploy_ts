#!/bin/bash

# 環境変数の設定
AWS_REGION_NAME=${AWS_REGION_NAME:-ap-northeast-1}
ECR_REPOSITORY_NAME=${ECR_REPOSITORY_NAME:-ecs-tutorial}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
REPOSITORY_URI=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION_NAME}.amazonaws.com/${ECR_REPOSITORY_NAME}
IMAGE_TAG=${IMAGE_TAG:-latest}

# Dockerのログイン
aws ecr --region ${AWS_REGION_NAME} get-login-password | docker login --username AWS --password-stdin https://${REPOSITORY_URI}

# Dockerイメージのビルドとプッシュ
# Gradlew の存在チェック
if [ ! -f "./gradlew" ]; then
  echo "gradlew not found. Make sure to include it in your project."
  exit 1
fi

# Gradlew へ実行権限を付与
chmod +x gradlew
./gradlew clean build

docker image build -t ${REPOSITORY_URI}:${IMAGE_TAG} .
docker image push ${REPOSITORY_URI}:${IMAGE_TAG}


cd ../
printf '{"name":"%s","ImageURI":"%s"}' $ECR_REPOSITORY_NAME $REPOSITORY_URI:$IMAGE_TAG > ./codebuild/imageDetail.json
