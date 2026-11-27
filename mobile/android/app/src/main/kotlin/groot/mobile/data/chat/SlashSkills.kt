package groot.mobile.data.chat

import groot.mobile.data.api.Skill

data class SkillInsert(val text: String, val caret: Int)

private val SKILL_TOKEN = Regex("^/([a-z0-9-]*)$")

fun activeSkillQuery(text: String, caret: Int): String? =
    SKILL_TOKEN.find(text.substring(0, minOf(caret, text.length)))?.groupValues?.get(1)

fun insertSkill(text: String, caret: Int, name: String): SkillInsert {
    val start = "/$name "
    return SkillInsert(start + text.substring(minOf(caret, text.length)).trimStart(), start.length)
}

fun botSkills(all: List<Skill>, skillIds: List<String>, query: String): List<Skill> =
    all.filter { it.id in skillIds && it.name.startsWith(query) }
