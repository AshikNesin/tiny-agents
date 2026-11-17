// APP-owned: your app's build file. Shared config comes from the groot.* convention plugins.
import java.util.Properties

plugins {
    alias(libs.plugins.groot.android.application)
    alias(libs.plugins.groot.compose)
    alias(libs.plugins.groot.test)
    alias(libs.plugins.roborazzi)
}

// Versions live in version.properties, never in this file (AGENTS.md).
val versionProps = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}

val gitCommit: String = providers.exec {
    commandLine("git", "rev-parse", "--short", "HEAD")
    isIgnoreExitValue = true
}.standardOutput.asText.map { it.trim().ifEmpty { "unknown" } }.getOrElse("unknown")

android {
    // The Kotlin namespace stays fixed; groot:setup changes only applicationId.
    namespace = "groot.mobile"

    defaultConfig {
        applicationId = "io.nesin.tinyagents"
        versionName = versionProps.getProperty("VERSION_NAME")
        versionCode = versionProps.getProperty("VERSION_CODE").toInt()
        buildConfigField("String", "GIT_COMMIT", "\"$gitCommit\"")
        // The server whose links (push notifications') open the app (AndroidManifest.xml).
        // Another server: build with -PtinyAgents.linkHost=agents.example.com.
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
    // Already in the graph through the kit and activity: the share sheet uses its shortcut and intent helpers.
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.okhttp)
    // Phone notifications (issue #306): Web Push through the owner's UnifiedPush distributor, else
    // Google's, embedded (no Firebase project). Size budget: mobile/docs/app/README.md.
    implementation(libs.unifiedpush.connector)
    implementation(libs.unifiedpush.embedded.fcm)

    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
}
