package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.api.TranscriptItem
import groot.mobile.data.chat.MentionCandidate
import groot.mobile.data.chat.MentionToken
import groot.mobile.data.chat.activeMentionToken
import groot.mobile.data.chat.insertMention
import groot.mobile.data.chat.mentionMatches
import groot.mobile.data.chat.resolveMentions
import groot.mobile.data.chat.trackPickedMentions
import groot.mobile.data.code.answeredRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MentionsTest {
    private val research = MentionCandidate("b1", "Research")
    private val writer = MentionCandidate("b2", "Writer")
    private val writerToo = MentionCandidate("b3", "Writer")
    private val host = MentionCandidate("host", "Host")

    @Test
    fun `an @ at the start of a word opens suggestions for what follows it`() {
        assertEquals(MentionToken(4, "Re"), activeMentionToken("ask @Re", 7))
        assertEquals(MentionToken(0, ""), activeMentionToken("@", 1))
        assertNull(activeMentionToken("mail me@home", 12))
        assertNull(activeMentionToken("ask @Re now", 11))
    }

    @Test
    fun `suggestions match the start of a bot's name, ignoring case`() {
        assertEquals(listOf(research), mentionMatches(listOf(research, writer), "re"))
    }

    @Test
    fun `picking a bot writes its name and remembers which bot it was`() {
        val result = insertMention("ask @wr please", MentionToken(4, "wr"), 7, writerToo, emptyList())
        assertEquals("ask @Writer  please", result.text)
        assertEquals(12, result.caret)
        assertEquals(listOf("b3"), resolveMentions(result.text, listOf(writer, writerToo), "host", result.picked).ids)
    }

    @Test
    fun `a typed name is sent as a mention, except the host bot and a name two bots share`() {
        val bots = listOf(research, writer, writerToo, host)
        val resolved = resolveMentions("@research and @Writer, also @Host", bots, "host")
        assertEquals(listOf("b1"), resolved.ids)
        assertEquals(listOf("Writer"), resolved.ambiguous)
        assertEquals(emptyList<String>(), resolveMentions("email@Research or @Researcher", bots, "host").ids)
    }

    @Test
    fun `a picked mention moves with edits before it and is dropped when its name is changed`() {
        val picked = insertMention("@w", MentionToken(0, "w"), 2, writerToo, emptyList()).picked
        val moved = trackPickedMentions("@Writer ", "Hi @Writer ", picked)
        assertEquals(3, moved.single().start)
        assertEquals(emptyList<Any>(), trackPickedMentions("@Writer ", "@Wrter ", picked))
    }

    @Test
    fun `a Code thread suggests a next prompt only after a finished reply`() {
        assertEquals("t1", answeredRow(listOf(TranscriptItem.User("u1", "hi", emptyList()), TranscriptItem.Turn("t1", 1000, null))))
        assertEquals("a1", answeredRow(listOf(TranscriptItem.Assistant("a1", "done"))))
        assertNull(answeredRow(listOf(TranscriptItem.User("u1", "hi", emptyList()))))
        assertNull(answeredRow(emptyList()))
    }
}
