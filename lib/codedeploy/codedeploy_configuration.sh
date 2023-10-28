#!/bin/bash

# jqのインストール
yum install -y jq

# template-taskdef.jsonの編集
jq '.executionRoleArn = env.TASK_EXEC_ROLE |
    .containerDefinitions[0].name = env.APPLICATION |
    .family = env.FARGATE_TASK_DEFINITION' template-taskdef.json > temp.json
mv temp.json taskdef.json

# template-appspec.yamlの編集
sed 's/ContainerName: "APPLICATION"/ContainerName: "'"$APPLICATION"'"/' template-appspec.yaml > temp.yaml
mv temp.yaml appspec.yaml
