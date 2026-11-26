package groot.mobile

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.kit.theme.GrootTheme
import groot.mobile.data.api.ToolStatus
import groot.mobile.feature.chat.ChatActions
import groot.mobile.feature.chat.ToolSteps
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AllowEveryBotTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `allow for every bot sends the waiting tool for every bot`() {
        var allowed: Pair<Int, String>? = null
        val actions = ChatActions(
            botName = "Travel Planner",
            labels = sampleLabels,
            askOnlyTools = emptySet(),
            readOnly = false,
            now = { FIXED_NOW },
            onDecide = { _, _, _, _ -> },
            onAnswer = { _, _ -> },
            onOpenCredentials = {},
            onCancelCredentials = {},
            onOpenComputer = {},
            onOpenLink = {},
            onAllowEveryBot = { taskId, name -> allowed = taskId to name },
        )
        compose.setContent {
            GrootTheme { ToolSteps(listOf(tool("run_command", status = ToolStatus.AwaitingApproval, taskId = 7)), actions) }
        }
        compose.onNodeWithText("Allow for every bot").performClick()
        assertEquals(7 to "run_command", allowed)
    }
}
