import java.util.Properties

plugins {
    alias(libs.plugins.groot.android.application)
    alias(libs.plugins.groot.compose)
    alias(libs.plugins.groot.test)
    alias(libs.plugins.roborazzi)
}

val versionProps = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}

val gitCommit: String = providers.exec {
    commandLine("git", "rev-parse", "--short", "HEAD")
    isIgnoreExitValue = true
}.standardOutput.asText.map { it.trim().ifEmpty { "unknown" } }.getOrElse("unknown")

android {
    namespace = "groot.mobile"

    defaultConfig {
        applicationId = "io.nesin.tinyagents"
        versionName = versionProps.getProperty("VERSION_NAME")
        versionCode = versionProps.getProperty("VERSION_CODE").toInt()
        buildConfigField("String", "GIT_COMMIT", "\"$gitCommit\"")
        manifestPlaceholders["linkHost"] = providers.gradleProperty("tinyAgents.linkHost").getOrElse("tiny-agents.ashiknesin.com")
    }

    buildFeatures {
        buildConfig = true
    }
}

roborazzi {
    outputDir.set(file("build/outputs/roborazzi"))
}

dependencies {
    implementation(project(":kit"))
    implementation(project(":vnc"))
    implementation(project(":terminal"))
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.okhttp)
    implementation(libs.unifiedpush.connector)
    implementation(libs.unifiedpush.embedded.fcm)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.fragment)

    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
}
