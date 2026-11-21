package groot.mobile

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.PickedFile
import groot.mobile.data.SharedContent
import groot.mobile.data.api.AttachmentRef
import groot.mobile.data.botIdOfShortcut
import groot.mobile.data.parseShareIntent
import groot.mobile.data.shareMessage
import groot.mobile.data.shareShortcutId
import groot.mobile.data.shareTargetBots
import groot.mobile.data.sharedText
import groot.mobile.feature.chat.StagedUpload
import groot.mobile.feature.share.ShareDraft
import groot.mobile.feature.share.fileType
import groot.mobile.feature.share.filterBots
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric

@RunWith(AndroidJUnit4::class)
class ShareTest {
    private val csv = Uri.parse("content://files/artha-net-worth.csv")
    private val photo = Uri.parse("content://media/photo/12")

    @Test
    fun `a shared file arrives as one stream`() {
        val intent = Intent(Intent.ACTION_SEND).setType("text/csv").putExtra(Intent.EXTRA_STREAM, csv)
        assertEquals(SharedContent(uris = listOf(csv)), parseShareIntent(intent))
    }

    @Test
    fun `several shared files arrive as a list of streams`() {
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*")
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(csv, photo))
        assertEquals(listOf(csv, photo), parseShareIntent(intent)?.uris)
    }

    @Test
    fun `an app that puts its file only in the clip data still shares it`() {
        val intent = Intent(Intent.ACTION_SEND).setType("image/jpeg")
        intent.clipData = ClipData.newRawUri("photo", photo)
        assertEquals(listOf(photo), parseShareIntent(intent)?.uris)
    }

    @Test
    fun `a shared link keeps its page title and the bot of a Direct Share target`() {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "  https://example.com/flights  ")
            .putExtra(Intent.EXTRA_SUBJECT, "Cheap flights")
            .putExtra(Intent.EXTRA_SHORTCUT_ID, "bot:b2")
        assertEquals(
            SharedContent(text = "https://example.com/flights", subject = "Cheap flights", botId = "b2"),
            parseShareIntent(intent),
        )
    }

    @Test
    fun `an intent that is not a share, or carries nothing, opens no sheet`() {
        assertNull(parseShareIntent(Intent(Intent.ACTION_VIEW, csv)))
        assertNull(parseShareIntent(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "   ")))
        assertNull(parseShareIntent(Intent(Intent.ACTION_SEND).setType("text/plain")))
    }

    @Test
    fun `a Direct Share target's shortcut names its bot`() {
        assertEquals("bot:b1", shareShortcutId("b1"))
        assertEquals("b1", botIdOfShortcut("bot:b1"))
        assertNull(botIdOfShortcut("bot:"))
        assertNull(botIdOfShortcut("other:b1"))
        assertNull(botIdOfShortcut(null))
    }

    @Test
    fun `the page title goes above its link unless the text already says it`() {
        assertEquals("Cheap flights\nhttps://example.com/f", sharedText(SharedContent(text = "https://example.com/f", subject = "Cheap flights")))
        assertEquals("Cheap flights https://example.com/f", sharedText(SharedContent(text = "Cheap flights https://example.com/f", subject = "Cheap flights")))
        assertEquals("Just text", sharedText(SharedContent(text = "Just text")))
        assertNull(sharedText(SharedContent(uris = listOf(csv), subject = "Fwd: statement")))
        assertNull(sharedText(SharedContent(uris = listOf(csv))))
    }

    @Test
    fun `the note goes first, then what was shared`() {
        assertEquals("Summarise this\n\nhttps://example.com/f", shareMessage("  Summarise this ", "https://example.com/f"))
        assertEquals("https://example.com/f", shareMessage("   ", "https://example.com/f"))
        assertEquals("Only a note", shareMessage("Only a note", null))
        assertEquals("", shareMessage("", null))
    }

    @Test
    fun `send needs a bot and something to send`() {
        val uploading = StagedUpload("u1", PickedFile(csv, "artha-net-worth.csv", "text/csv", 797))
        val uploaded = uploading.copy(ref = AttachmentRef("up1", "file", "artha-net-worth.csv", "text/csv", 797))
        val failed = uploading.copy(error = "Files can be up to 25 MB.")

        assertFalse("no bot", ShareDraft(staged = listOf(uploaded)).canSend)
        assertFalse("nothing to send", ShareDraft(botId = "b1", note = "  ").canSend)
        assertFalse("only a failed upload", ShareDraft(botId = "b1", staged = listOf(failed)).canSend)
        assertFalse("already sending", ShareDraft(botId = "b1", note = "hi", sending = true).canSend)

        assertTrue(ShareDraft(botId = "b1", staged = listOf(uploaded)).canSend)
        assertTrue(ShareDraft(botId = "b1", staged = listOf(uploading)).canSend)
        assertTrue(ShareDraft(botId = "b1", sharedText = "https://example.com").canSend)
        assertTrue(ShareDraft(botId = "b1", note = "Look at this").canSend)
    }

    @Test
    fun `the To field narrows the bots by name, in the drawer's order`() {
        val sorted = sampleBotsState.sorted
        assertEquals(sorted, filterBots(sorted, "  "))
        assertEquals(listOf("Travel Planner", "Researcher", "Writer"), filterBots(sorted, "er").map { it.name })
        assertEquals(listOf("Ops"), filterBots(sorted, "oP").map { it.name })
        assertEquals(emptyList<String>(), filterBots(sorted, "nobody").map { it.name })
    }

    @Test
    fun `Direct Share offers the top of the drawer, once the list is in`() {
        assertEquals(listOf("Travel Planner", "Researcher", "Ops", "Writer"), shareTargetBots(sampleBotsState, 4).map { it.name })
        assertEquals(listOf("Travel Planner"), shareTargetBots(sampleBotsState, 1).map { it.name })
        assertEquals(emptyList<String>(), shareTargetBots(sampleBotsState.copy(loading = true), 4).map { it.name })
    }

    @Test
    fun `a file card shows its type from the extension`() {
        assertEquals("CSV", fileType("artha-net-worth.csv"))
        assertEquals("PDF", fileType("Statement.Final.pdf"))
        assertEquals("FILE", fileType("README"))
        assertEquals("FILE", fileType("archive.verylongext"))
    }

    @Test
    fun `Android routes a share from another app to the share sheet`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        for (intent in listOf(
            Intent(Intent.ACTION_SEND).setType("text/csv"),
            Intent(Intent.ACTION_SEND).setType("text/plain"),
            Intent(Intent.ACTION_SEND_MULTIPLE).setType("image/*"),
        )) {
            val targets = context.packageManager.queryIntentActivities(intent, 0).map { it.activityInfo.name }
            assertEquals(intent.toString(), listOf(ShareActivity::class.java.name), targets)
        }
    }

    @Test
    fun `the share sheet closes at once for an intent that shares nothing`() {
        val activity = Robolectric.buildActivity(ShareActivity::class.java, Intent(Intent.ACTION_SEND).setType("text/plain")).setup().get()
        assertTrue(activity.isFinishing)
    }
}
