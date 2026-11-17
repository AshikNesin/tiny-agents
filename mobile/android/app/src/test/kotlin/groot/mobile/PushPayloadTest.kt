package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.push.ApprovalActions
import groot.mobile.push.ApprovalAnswer
import groot.mobile.push.ApprovalDecision
import groot.mobile.push.PushChannel
import groot.mobile.push.PushPayload
import groot.mobile.push.decisionOf
import groot.mobile.push.spec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/** The server's Web Push payloads (issue #306), and the notification each becomes. */
@RunWith(AndroidJUnit4::class)
class PushPayloadTest {
    @Test
    fun `a tool approval shows on Needs you with the chat card's three buttons`() {
        val payload = PushPayload.parse(
            """{"v":1,"kind":"show","id":"n1","tag":"wait:ops:12","event":"approval.requested","category":"needs_input",
               "title":"Ops wants to run a command","message":"git push origin main","path":"/chats/ops?focus=approval:12",
               "priority":1,"actions":{"kind":"tool","botId":"ops","taskId":12,"tool":"bash"}}""",
        ) as PushPayload.Show
        val spec = payload.spec()
        assertEquals(PushChannel.NeedsYou, spec.channel)
        assertEquals("wait:ops:12", spec.tag)
        assertEquals("/chats/ops?focus=approval:12", spec.path)
        assertEquals(ApprovalActions(ApprovalActions.Kind.Tool, "ops", 12, "bash", grantable = false), spec.actions)
        assertEquals(listOf(ApprovalAnswer.Deny, ApprovalAnswer.Approve, ApprovalAnswer.AlwaysAllow), spec.buttons)
    }

    @Test
    fun `a vault approval offers For this chat only when the server says it can be granted`() {
        fun buttons(grantable: Boolean) = (
            PushPayload.parse(
                """{"v":1,"kind":"show","tag":"t","title":"T","message":"M","priority":1,
                   "actions":{"kind":"vault","botId":"ops","taskId":3,"tool":"vault_use","grantable":$grantable}}""",
            ) as PushPayload.Show
            ).spec().buttons
        assertEquals(listOf(ApprovalAnswer.Deny, ApprovalAnswer.Approve, ApprovalAnswer.ForThisChat), buttons(grantable = true))
        assertEquals(listOf(ApprovalAnswer.Deny, ApprovalAnswer.Approve), buttons(grantable = false))
    }

    @Test
    fun `an update has no buttons, and categories map to their channels`() {
        val spec = (
            PushPayload.parse("""{"v":1,"kind":"show","tag":"batch:x","category":"notify","title":"T","message":"M","priority":0}""")
                as PushPayload.Show
            ).spec()
        assertEquals(PushChannel.Updates, spec.channel)
        assertEquals(emptyList<ApprovalAnswer>(), spec.buttons)
        assertEquals(PushChannel.Security, PushChannel.of("security"))
        assertEquals(PushChannel.System, PushChannel.of("system"))
    }

    @Test
    fun `a dismiss takes back its tag, and unknown payloads are ignored`() {
        assertEquals(PushPayload.Dismiss("wait:ops:12"), PushPayload.parse("""{"v":1,"kind":"dismiss","tag":"wait:ops:12"}"""))
        assertNull(PushPayload.parse("""{"v":2,"kind":"dismiss","tag":"t"}"""))
        assertNull(PushPayload.parse("""{"v":1,"kind":"vibrate","tag":"t"}"""))
        assertNull(PushPayload.parse("not json"))
    }

    @Test
    fun `each button posts what the chat card would`() {
        assertEquals(ApprovalDecision(approved = false, alwaysAllow = null, grant = false), decisionOf(ApprovalAnswer.Deny, "bash"))
        assertEquals(ApprovalDecision(approved = true, alwaysAllow = null, grant = false), decisionOf(ApprovalAnswer.Approve, "bash"))
        assertEquals(ApprovalDecision(approved = true, alwaysAllow = "bash", grant = false), decisionOf(ApprovalAnswer.AlwaysAllow, "bash"))
        assertEquals(ApprovalDecision(approved = true, alwaysAllow = null, grant = true), decisionOf(ApprovalAnswer.ForThisChat, "vault_use"))
    }
}
