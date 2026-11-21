plugins {
    alias(libs.plugins.groot.android.library)
    alias(libs.plugins.groot.compose)
    alias(libs.plugins.groot.test)
}

android {
    namespace = "tinyagents.terminal"

    lint {
        disable += "ObsoleteLintCustomCheck"
    }
}

dependencies {
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
}

tasks.withType<Test>().configureEach {
    inputs.property("terminalTmuxTest", providers.environmentVariable("TERMINAL_TMUX_TEST").orElse(""))
}
