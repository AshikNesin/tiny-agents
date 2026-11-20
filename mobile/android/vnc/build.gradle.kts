plugins {
    alias(libs.plugins.groot.android.library)
    alias(libs.plugins.groot.compose)
    alias(libs.plugins.groot.test)
}

android {
    namespace = "tinyagents.vnc"

    lint {
        disable += "ObsoleteLintCustomCheck"
    }
}

dependencies {
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
}
