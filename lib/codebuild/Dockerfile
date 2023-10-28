# 基本となるイメージを指定します。この例では、OpenJDK 11をベースにしています。
FROM openjdk:11-jdk-slim

# アプリケーションのJARファイルをコンテナにコピーします。
# この例では、ビルドプロセスが my-web-app.war ファイルを作成すると仮定しています。
COPY build/libs/my-web-app.war /usr/app/my-web-app.war

# コンテナが実行するコマンドを指定します。
ENTRYPOINT ["java", "-jar", "/usr/app/my-web-app.war"]
