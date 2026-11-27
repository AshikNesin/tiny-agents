package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.api.Skill
import groot.mobile.data.chat.SkillInsert
import groot.mobile.data.chat.activeSkillQuery
import groot.mobile.data.chat.botSkills
import groot.mobile.data.chat.insertSkill
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SlashSkillsTest {
    private fun skill(id: String, name: String) = Skill(id, name, "", "", 0, "manual", null, emptyList())

    @Test
    fun `a slash at the very start opens skill suggestions`() {
        assertEquals("sh", activeSkillQuery("/sh", 3))
        assertEquals("", activeSkillQuery("/", 1))
        assertNull(activeSkillQuery("see /sh", 7))
        assertNull(activeSkillQuery("/show-me now", 12))
    }

    @Test
    fun `picking a skill writes slash name and keeps what follows`() {
        assertEquals(SkillInsert("/show-me draw it", 9), insertSkill("/sh draw it", 3, "show-me"))
    }

    @Test
    fun `only the bot's skills that match are offered`() {
        val all = listOf(skill("s1", "show-me"), skill("s2", "shopping"), skill("s3", "summarize"))
        assertEquals(listOf("show-me"), botSkills(all, listOf("s1", "s3"), "sh").map { it.name })
    }
}
