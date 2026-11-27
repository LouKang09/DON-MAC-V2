FROM gradle:8.9-jdk17 AS build
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip && rm -rf /var/lib/apt/lists/*
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/cli.zip && unzip -q /tmp/cli.zip -d /tmp/android-cli && mv /tmp/android-cli/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && rm -rf /tmp/cli.zip /tmp/android-cli
RUN yes | sdkmanager --sdk_root=${ANDROID_HOME} --licenses >/dev/null && sdkmanager --sdk_root=${ANDROID_HOME} "platforms;android-35" "build-tools;35.0.0"
WORKDIR /workspace
COPY android-attendance/ /workspace/
RUN gradle assembleDebug --no-daemon && cp app/build/outputs/apk/debug/app-debug.apk /tmp/donmac-attendance-test.apk
FROM python:3.12-alpine
WORKDIR /app
COPY --from=build /tmp/donmac-attendance-test.apk /app/donmac-attendance-test.apk
COPY android-attendance/download-server.py /app/server.py
EXPOSE 8080
CMD ["python","server.py"]
