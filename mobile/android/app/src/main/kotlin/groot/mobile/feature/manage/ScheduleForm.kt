package groot.mobile.feature.manage

import groot.mobile.data.api.Schedule

data class ScheduleForm(
    val kind: Kind = Kind.Daily,
    val time: String = "09:00",
    val weekday: Int = 1,
    val minutes: Int = 60,
    val date: String = "",
    val cron: String = "0 9 * * *",
) {
    enum class Kind(val label: String) {
        Daily("Every day"),
        Weekdays("Weekdays"),
        Weekly("Every week"),
        Interval("Every few hours"),
        Once("Once"),
        Cron("Custom cron"),
    }

    fun toSchedule(): Schedule? {
        val clock = TIME.find(time.trim())
        val hour = clock?.groupValues?.get(1)?.toIntOrNull()
        val minute = clock?.groupValues?.get(2)?.toIntOrNull()
        val timeOk = hour != null && minute != null && hour in 0..23 && minute in 0..59
        return when (kind) {
            Kind.Daily -> if (timeOk) Schedule.Cron("$minute $hour * * *") else null
            Kind.Weekdays -> if (timeOk) Schedule.Cron("$minute $hour * * 1-5") else null
            Kind.Weekly -> if (timeOk && weekday in 0..6) Schedule.Cron("$minute $hour * * $weekday") else null
            Kind.Interval -> if (minutes in MIN_INTERVAL..MAX_INTERVAL) Schedule.Interval(minutes) else null
            Kind.Once -> if (timeOk && DATE.matches(date.trim())) Schedule.Once("${date.trim()}T${"%02d:%02d".format(hour, minute)}:00+05:30") else null
            Kind.Cron -> if (cron.trim().split(Regex("\\s+")).size == 5) Schedule.Cron(cron.trim()) else null
        }
    }

    val error: String?
        get() = if (toSchedule() != null) {
            null
        } else {
            when (kind) {
                Kind.Interval -> "Pick between 15 minutes and 24 hours."
                Kind.Once -> "Use a date like 2026-12-01 and a time like 09:00."
                Kind.Cron -> "Use five fields: minute hour day-of-month month day-of-week."
                else -> "Use a 24-hour time like 09:00."
            }
        }

    companion object {
        const val MIN_INTERVAL = 15
        const val MAX_INTERVAL = 1440
        val WEEKDAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
        private val TIME = Regex("^(\\d{1,2}):(\\d{2})$")
        private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        private val DAILY = Regex("^(\\d{1,2}) (\\d{1,2}) \\* \\* \\*$")
        private val WEEKDAY = Regex("^(\\d{1,2}) (\\d{1,2}) \\* \\* 1-5$")
        private val WEEKLY = Regex("^(\\d{1,2}) (\\d{1,2}) \\* \\* ([0-6])$")
        private val ONCE = Regex("^(\\d{4}-\\d{2}-\\d{2})T(\\d{2}:\\d{2})")

        private fun clock(match: MatchResult) = "%02d:%02d".format(match.groupValues[2].toInt(), match.groupValues[1].toInt())

        fun of(schedule: Schedule): ScheduleForm = when (schedule) {
            is Schedule.Interval -> ScheduleForm(kind = Kind.Interval, minutes = schedule.minutes)
            is Schedule.Once -> ONCE.find(schedule.at)?.let { ScheduleForm(kind = Kind.Once, date = it.groupValues[1], time = it.groupValues[2]) }
                ?: ScheduleForm(kind = Kind.Once)
            is Schedule.Cron -> {
                val expr = schedule.expr.trim()
                DAILY.find(expr)?.let { ScheduleForm(kind = Kind.Daily, time = clock(it), cron = expr) }
                    ?: WEEKDAY.find(expr)?.let { ScheduleForm(kind = Kind.Weekdays, time = clock(it), cron = expr) }
                    ?: WEEKLY.find(expr)?.let { ScheduleForm(kind = Kind.Weekly, time = clock(it), weekday = it.groupValues[3].toInt(), cron = expr) }
                    ?: ScheduleForm(kind = Kind.Cron, cron = expr)
            }
        }
    }
}
