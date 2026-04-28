function formatMonthName(now) {
  const monthShort = now.toLocaleDateString("en-GB", { month: "short" });
  const yearShort = String(now.getFullYear()).slice(2);
  return `${monthShort} '${yearShort}`;
}

function normalizeMonthName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildClassEntry(course, slot) {
  return {
    courseCode: course.courseCode,
    courseTitle: course.courseTitle,
    credit: course.credit,
    category: course.category,
    courseType: course.courseType,
    facultyName: course.facultyName,
    facultyPhotoUrl: course.facultyPhotoUrl || "",
    slot: course.slot,
    roomNo: course.roomNo,
    timing: slot.timing,
    hourIndex: slot.hourIndex,
    slotToken: slot.slotToken,
  };
}

export function buildScheduleFromData({
  timetable,
  calendar = null,
  studentInfo = null,
  overrideDayOrder = null,
  now = new Date(),
}) {
  const todayDate = String(now.getDate());
  const todayDay = now.toLocaleDateString("en-GB", { weekday: "short" });
  const monthName = formatMonthName(now);

  if (!timetable || !Array.isArray(timetable.courses)) {
    throw new Error("timetable data is required to build schedule");
  }

  if (overrideDayOrder) {
    const dayLabel = `Day ${overrideDayOrder}`;
    const classes = [];

    for (const course of timetable.courses) {
      for (const slot of (course.schedule || [])) {
        if (slot.day === dayLabel) {
          classes.push(buildClassEntry(course, slot));
        }
      }
    }

    classes.sort((a, b) => a.hourIndex - b.hourIndex);
    return {
      date: todayDate,
      monthName,
      dayOfWeek: todayDay,
      dayOrder: overrideDayOrder,
      todayDayOrder: null,
      event: "",
      isHoliday: false,
      isWeekend: false,
      isOverride: true,
      semester: null,
      semType: null,
      classes,
    };
  }

  if (!studentInfo) {
    throw new Error("student info is required to build today's schedule");
  }
  if (!calendar || !Array.isArray(calendar.months)) {
    throw new Error("calendar data is required to build today's schedule");
  }

  const semNum = parseInt(studentInfo.Semester || "1", 10);
  const semType = semNum % 2 === 0 ? "even" : "odd";

  let dayOrder = null;
  let todayEvent = "";
  let isWeekend = now.getDay() === 0 || now.getDay() === 6;

  const targetMonth = calendar.months.find(
    (month) => normalizeMonthName(month.name) === normalizeMonthName(monthName),
  );

  if (targetMonth) {
    const dayEntry = (targetMonth.days || []).find(
      (entry) => String(entry.date).trim() === todayDate,
    );
    if (dayEntry) {
      isWeekend = dayEntry.day === "Sat" || dayEntry.day === "Sun";
      todayEvent = dayEntry.event || "";
      dayOrder = dayEntry.dayOrder && dayEntry.dayOrder !== "-" ? dayEntry.dayOrder : null;
    }
  }

  const isHoliday = !isWeekend && !dayOrder && !!todayEvent;
  const activeDayLabel = dayOrder ? `Day ${dayOrder}` : null;
  const classes = [];

  if (activeDayLabel) {
    for (const course of timetable.courses) {
      for (const slot of (course.schedule || [])) {
        if (slot.day === activeDayLabel) {
          classes.push(buildClassEntry(course, slot));
        }
      }
    }
    classes.sort((a, b) => a.hourIndex - b.hourIndex);
  }

  return {
    date: todayDate,
    monthName,
    dayOfWeek: todayDay,
    dayOrder,
    todayDayOrder: dayOrder,
    event: todayEvent,
    isHoliday,
    isWeekend,
    isOverride: false,
    semester: String(semNum),
    semType,
    classes,
  };
}
