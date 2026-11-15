package groot.mobile

import groot.mobile.data.api.CredentialRequest
import groot.mobile.data.api.ToolStatus
import groot.mobile.data.api.VaultUse
import groot.mobile.data.chat.ToolCard
import groot.mobile.data.chat.ToolPhase
import groot.mobile.data.chat.ToolStep
import groot.mobile.data.chat.approvalNote
import groot.mobile.data.chat.approvalText
import groot.mobile.data.chat.credentialRequestText
import groot.mobile.data.chat.describeCalls
import groot.mobile.data.chat.durationText
import groot.mobile.data.chat.formatWait
import groot.mobile.data.chat.stepTitle
import groot.mobile.data.chat.toolLabel
import groot.mobile.data.chat.toolSteps
import groot.mobile.data.chat.vaultApprovalText
import groot.mobile.data.chat.viewOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** How tool calls are worded and which card draws them (the web client's tool-call-view and tool-call-text). */
class ToolCallTextTest {
    @Test
    fun `labels come from the catalog, else from the tool's name`() {
        assertEquals("Searched the web", toolLabel(sampleLabels, "web_search"))
        assertEquals("Create Issue via linear", toolLabel(sampleLabels, "mcp__linear__create_issue"))
        assertEquals("save skill", toolLabel(sampleLabels, "save_skill"))
        assertEquals("Using skill pdf", stepTitle(tool("load_skill", mapOf("name" to "pdf")), sampleLabels))
        assertEquals("Opened a page “https://x.test”", stepTitle(tool("browser_open", mapOf("url" to "https://x.test")), sampleLabels))
    }

    @Test
    fun `an approval card says what the bot wants, with long payloads folded`() {
        val text = approvalText(tool("run_command", mapOf("name" to "ls -la")), "Ops", sampleLabels)
        assertEquals("Ops wants to run a command: “ls -la”", text.title)
        assertNull(text.foldedPayload)
        val long = approvalText(tool("update_instructions", mapOf("append" to "x".repeat(200))), "Ops", sampleLabels)
        assertEquals(200, long.foldedPayload?.length)
        val newBot = approvalText(tool("create_bot", mapOf("name" to "Helper", "description" to "Helps")), "Ops", sampleLabels)
        assertEquals(listOf("Description", "Model", "Instructions"), newBot.facts.map { it.label })
    }

    @Test
    fun `each waiting status gets its card, and a past chat gets none`() {
        val approval = tool("x", status = ToolStatus.AwaitingApproval, taskId = 1)
        assertEquals(ToolCard.Approval, viewOf(approval).card)
        assertNull(viewOf(approval, readOnly = true).card)
        assertEquals("not answered", viewOf(approval, readOnly = true).note)
        val vault = approval.copy(vault = VaultUse("h", "GitHub", "login", "browser_fill_secret", "https://github.com", null, null, "ashik", true, emptyList(), emptyList()))
        assertEquals(ToolCard.VaultApproval, viewOf(vault).card)
        val credentials = tool("request_credentials", status = ToolStatus.AwaitingCredentials, taskId = 2)
            .copy(credentials = CredentialRequest("pending", "https://github.com", "Sign in to GitHub", "to open the repo", emptyList(), emptyList(), null))
        assertEquals(ToolCard.Credentials, viewOf(credentials).card)
        assertEquals("Ops needs you on github.com", credentialRequestText(credentials, "Ops", FIXED_NOW).first)
        assertEquals(ToolPhase.Failed, viewOf(tool("x", status = ToolStatus.Denied)).phase)
        assertEquals("denied by you", viewOf(tool("x", status = ToolStatus.Denied)).note)
    }

    @Test
    fun `a vault card names the item and where it goes, never a value`() {
        val call = tool("browser_fill_secret", status = ToolStatus.AwaitingApproval, taskId = 1).copy(
            vault = VaultUse("visa", "Visa", "card", "browser_fill_secret", "https://shop.test", "Visa", "4242", null, true, emptyList(), emptyList()),
            expiresAt = FIXED_NOW + 150_000,
        )
        val text = vaultApprovalText(call, "Shopper", FIXED_NOW)
        assertEquals("Shopper wants to fill Visa ••4242 on https://shop.test", text.title)
        assertTrue(text.description.endsWith("Expires in 3 minutes."))
    }

    @Test
    fun `runs of finished calls fold, and say what they did`() {
        val calls = listOf(tool("web_search"), tool("web_fetch", mapOf("url" to "a")), tool("web_fetch", mapOf("url" to "b")), tool("x", status = ToolStatus.AwaitingApproval, taskId = 1), tool("web_search", mapOf("query" to "z")))
        val steps = toolSteps(calls)
        assertEquals(3, steps.size)
        assertEquals(3, (steps[0] as ToolStep.Group).calls.size)
        assertTrue(steps[2] is ToolStep.Single)
        assertEquals("Searched the web, read a page ×2", describeCalls(calls.take(3), sampleLabels))
    }

    @Test
    fun `durations, waits and approval notes read naturally`() {
        assertEquals("800ms", durationText(tool("x")))
        assertEquals("1.2s · waited 1m 40s for you", durationText(tool("x", durationMs = 1200).copy(waitedMs = 100_000)))
        assertEquals("2h 5m", formatWait(125 * 60_000L))
        assertEquals("auto-approved (YOLO)", approvalNote(null, "yolo"))
        assertEquals("nobody answered in time · approved by you", approvalNote("nobody answered in time", "approved"))
        assertNull(approvalNote(null, null))
    }
}
