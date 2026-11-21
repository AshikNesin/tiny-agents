package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.AppLink
import groot.mobile.data.AppLinks
import groot.mobile.data.parseAppLink
import groot.mobile.data.api.MessageRole
import groot.mobile.feature.chat.transcriptIndexOfTask
import groot.mobile.navigation.Routes
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.robolectric.Robolectric
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppLinksTest {
    private val server = "https://agents.example.com"

    @Test
    fun `a waiting card's link opens its chat, focused on the card`() {
        assertEquals(AppLink.Chat("c0abc", 61), parseAppLink("$server/chats/c0abc?focus=approval:61", server))
        assertEquals(AppLink.Chat("c0abc", 7), parseAppLink("$server/chats/c0abc?focus=question%3A7", server))
        assertEquals(AppLink.Chat("c0abc", 9), parseAppLink("$server/chats/c0abc?x=1&focus=takeover:9", server))
    }

    @Test
    fun `a chat link without a usable focus just opens the chat`() {
        assertEquals(AppLink.Chat("c0abc"), parseAppLink("$server/chats/c0abc", server))
        assertEquals(AppLink.Chat("c0abc"), parseAppLink("$server/chats/c0abc?focus=delete:1", server))
        assertEquals(AppLink.Chat("bot one"), parseAppLink("$server/chats/bot%20one", server))
    }

    @Test
    fun `sign-in requests and the other screens`() {
        assertEquals(AppLink.CredentialRequest(63), parseAppLink("$server/vault/requests/63", server))
        assertEquals(AppLink.Screen(Routes.VAULT), parseAppLink("$server/vault", server))
        assertEquals(AppLink.Screen("vault/items/github-work"), parseAppLink("$server/vault/items/github-work", server))
        assertEquals(AppLink.Screen(Routes.ROUTINES), parseAppLink("$server/routines", server))
        assertEquals(AppLink.Screen(Routes.TASKS), parseAppLink("$server/tasks", server))
        assertEquals(AppLink.Screen(Routes.HOME), parseAppLink("$server/", server))
    }

    @Test
    fun `a Code push opens the thread it is about`() {
        assertEquals(AppLink.Screen("code/thread/claude-code%3Aabc-123"), parseAppLink("$server/code/claude-code%3Aabc-123", server))
        assertEquals(AppLink.Screen("code/thread/cXYZ"), parseAppLink("$server/code/cXYZ", server))
        assertEquals(AppLink.Screen("code"), parseAppLink("$server/code", server))
    }

    @Test
    fun `another server's links and unknown paths open nothing in particular`() {
        assertNull(parseAppLink("https://evil.example.net/chats/c0abc?focus=approval:1", server))
        assertNull(parseAppLink("$server/code/a/b/c", server))
        assertNull(parseAppLink("$server/vault/requests/not-a-number", server))
        assertNull(parseAppLink("javascript:alert(1)", server))
        assertEquals(AppLink.Chat("c0abc", 1), parseAppLink("$server/chats/c0abc?focus=approval:1", null))
    }

    @Test
    fun `a link is taken once`() {
        val links = AppLinks()
        links.open(AppLink.Screen(Routes.TASKS))
        assertEquals(AppLink.Screen(Routes.TASKS), links.take())
        assertNull(links.take())
    }

    @Test
    fun `the focused card's row counts from the newest, after the typing dots`() {
        val view = sampleChatView(
            sampleApprovalMessages +
                message("a6", MessageRole.User, "Approve the update, I will sign in later.", minutesAgo = 1) +
                message("a7", MessageRole.Assistant, "Thanks.", minutesAgo = 0),
            busy = false,
        )
        assertEquals(2, transcriptIndexOfTask(view, 61))
        assertEquals(2, transcriptIndexOfTask(view, 64))
        assertNull(transcriptIndexOfTask(view, 999))
        assertEquals(3, transcriptIndexOfTask(view.copy(typing = true), 64))
    }

    @Test
    fun `the manifest sends the server's notification links, and only those, to the app`() {
        val pm = ApplicationProvider.getApplicationContext<Context>().packageManager
        fun opensApp(url: String) = pm.queryIntentActivities(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE),
            0,
        ).any { it.activityInfo.name == MainActivity::class.java.name }
        val host = "https://tiny-agents.ashiknesin.com"
        assertTrue(opensApp("$host/chats/c0abc?focus=approval:61"))
        assertTrue(opensApp("$host/vault/requests/63"))
        assertTrue(opensApp("$host/vault"))
        assertTrue(opensApp("$host/routines"))
        assertTrue(opensApp("$host/tasks"))
        assertFalse("Code stays in the browser", opensApp("$host/code/thread-1"))
        assertFalse(opensApp("https://agents.example.com/chats/c0abc"))
        assertFalse(opensApp("http://tiny-agents.ashiknesin.com/chats/c0abc"))
    }

    @Test
    fun `opening the app from a link queues it for the signed-in screens`() {
        val container = ApplicationProvider.getApplicationContext<GrootMobileApp>().container
        container.links.take()
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://tiny-agents.ashiknesin.com/chats/c0abc?focus=question:7"))
            .setClass(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
        Robolectric.buildActivity(MainActivity::class.java, intent).create().use {
            assertEquals(AppLink.Chat("c0abc", 7), container.links.pending.value)
        }
        container.links.take()
    }
}

