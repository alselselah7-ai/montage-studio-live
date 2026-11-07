
(() => {
  const cfg = window.APP_CONFIG || {};

  const ready =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR_");

  const $ = id => document.getElementById(id);

  if (!ready) {
    const msg = "يرجى إضافة رابط Supabase ومفتاح anon في ملف config.js.";

    ["connection", "live", "loginMsg", "notice"].forEach(id => {
      if ($(id)) $(id).textContent = msg;
    });

    return;
  }

  const db = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY
  );

  const isManager = !!$("adminApp");

  let employees = [];
  let roster = [];
  let tasks = [];
  let notice = "";
  let liveChannel = null;

  const getCurrentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };

  const shiftMonth = (month, offset) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const date = new Date(year, monthNumber - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };

  let currentMonth = getCurrentMonth();

  const weekdays = [
    "الأحد", "الإثنين", "الثلاثاء",
    "الأربعاء", "الخميس", "الجمعة", "السبت"
  ];

  const daysIn = month =>
    new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)),
      0
    ).getDate();

  const monthName = month =>
    new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)) - 1,
      1
    ).toLocaleDateString("ar", {
      month: "long",
      year: "numeric"
    });

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));

  // صفحة الموظفين تعرض الشهر الحالي فقط دون إتاحة الأشهر السابقة.
  function setupEmployeeMonth() {
    const select = $("month");
    const label = $("monthLabel");
    currentMonth = getCurrentMonth();

    if (select) {
      select.innerHTML = "";
      select.add(new Option(monthName(currentMonth), currentMonth));
      select.value = currentMonth;
      select.disabled = true;
    }

    if (label) label.textContent = monthName(currentMonth);
  }

  // إنشاء جدول الشهر الحالي تلقائياً اعتماداً على آخر جدول للشهر السابق.
  // الأيام الموجودة لا تُستبدل، حتى لا تضيع تعديلات الشهر الحالي.
  async function ensureCurrentMonthRoster(month) {
    if (month !== getCurrentMonth()) return;

    const previous = shiftMonth(month, -1);
    const [currentResult, previousResult] = await Promise.all([
      db.from("roster_entries").select("employee_id,day,shift").eq("month", month),
      db.from("roster_entries").select("employee_id,day,shift").eq("month", previous)
    ]);

    if (currentResult.error) throw currentResult.error;
    if (previousResult.error) throw previousResult.error;

    const existing = currentResult.data || [];
    const previousRows = previousResult.data || [];
    const currentKeys = new Set(existing.map(row => `${row.employee_id}:${row.day}`));
    const previousByEmployee = new Map();

    previousRows.forEach(row => {
      if (!previousByEmployee.has(row.employee_id)) {
        previousByEmployee.set(row.employee_id, new Map());
      }
      previousByEmployee.get(row.employee_id).set(Number(row.day), row.shift);
    });

    const previousDays = daysIn(previous);
    const rowsToInsert = [];

    employees.forEach((employee, employeeIndex) => {
      const previousPattern = previousByEmployee.get(employee.id) || new Map();

      for (let day = 1; day <= daysIn(month); day++) {
        if (currentKeys.has(`${employee.id}:${day}`)) continue;

        // كرر نمط أيام الشهر السابق بحسب رقم اليوم، ولفّ النمط عند اختلاف عدد الأيام.
        const sourceDay = ((day - 1) % previousDays) + 1;
        let shift = previousPattern.get(sourceDay);

        // إذا كان اليوم المقابل غير مسجل، ابحث عن أقرب يوم سابق مسجل.
        if (!shift && previousPattern.size) {
          for (let offset = 1; offset <= previousDays; offset++) {
            const candidateDay = ((sourceDay - offset - 1 + previousDays) % previousDays) + 1;
            if (previousPattern.has(candidateDay)) {
              shift = previousPattern.get(candidateDay);
              break;
            }
          }
        }

        // عند عدم وجود جدول سابق لهذا الموظف، استخدم النمط التلقائي الأساسي.
        if (!shift) {
          const weekday = new Date(
            Number(month.slice(0, 4)),
            Number(month.slice(5, 7)) - 1,
            day
          ).getDay();
          shift = weekday === 5 && (day + employeeIndex) % 2 === 0
            ? "off"
            : day % 2 === 0 ? "ص" : "م";
        }

        rowsToInsert.push({ month, employee_id: employee.id, day, shift });
      }
    });

    if (!rowsToInsert.length) return;

    const { error } = await db.from("roster_entries").upsert(rowsToInsert, {
      onConflict: "month,employee_id,day",
      ignoreDuplicates: true
    });
    if (error) throw error;
  }

  // إذا بقيت صفحة الموظفين مفتوحة عند دخول شهر جديد، حدّثها تلقائياً.
  function watchEmployeeMonthRollover() {
    if (isManager) return;

    const checkMonth = async () => {
      const actualMonth = getCurrentMonth();
      if (actualMonth === currentMonth) return;
      currentMonth = actualMonth;
      setupEmployeeMonth();
      try {
        await loadAll();
      } catch (error) {
        console.error("Month rollover error:", error);
      }
    };

    window.addEventListener("focus", checkMonth);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkMonth();
    });
    setInterval(checkMonth, 60 * 1000);
  }

  // تحميل بيانات النظام
  async function loadAll() {
    const month = isManager
      ? ($("month")?.value || currentMonth)
      : currentMonth;

    // تحميل الموظفين أولاً لأن إنشاء جدول الشهر يحتاج قائمة الموظفين النشطين.
    const employeeResult = await db.from("employees")
      .select("*")
      .eq("active", true)
      .order("name");

    if (employeeResult.error) throw employeeResult.error;
    employees = employeeResult.data || [];

    // عند فتح الشهر الحالي لأول مرة، انسخ نمط الشهر السابق تلقائياً.
    await ensureCurrentMonthRoster(month);

    const [r, t, n] = await Promise.all([
      db.from("roster_entries")
        .select("*")
        .eq("month", month),

      db.from("tasks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),

      db.from("settings")
        .select("value")
        .eq("key", "fixed_notice")
        .maybeSingle()
    ]);

    for (const result of [r, t, n]) {
      if (result.error) throw result.error;
    }

    roster = r.data || [];
    tasks = t.data || [];
    notice = n.data?.value || "";

    render();
  }

  // عرض جدول الدوام
  function renderRoster(
    targetHead,
    targetBody,
    month,
    editable
  ) {
    if (!targetHead || !targetBody) return;

    const count = daysIn(month);

    // الموظفون أعمدة، وأيام الشهر صفوف لتكون المناوبات أوضح وأسهل قراءة.
    targetHead.innerHTML = `
      <tr>
        <th class="roster-day-head">اليوم</th>
        ${employees.map(emp => `
          <th class="roster-employee-head">
            <b>${esc(emp.name)}</b>
            <small>${esc(emp.office || "")}</small>
          </th>
        `).join("")}
      </tr>
    `;

    targetBody.innerHTML = Array.from({ length: count }, (_, index) => {
      const day = index + 1;
      const weekday = weekdays[
        new Date(
          Number(month.slice(0, 4)),
          Number(month.slice(5, 7)) - 1,
          day
        ).getDay()
      ];

      const cells = employees.map(emp => {
        const record = roster.find(item =>
          item.employee_id === emp.id &&
          Number(item.day) === day
        );

        const value = record?.shift || "—";

        const shiftStyle =
          value === "م"
            ? "background:#0284c7;color:#fff;"
            : value === "ص"
              ? "background:#ea580c;color:#fff;"
              : value === "off"
                ? "background:#dc2626;color:#fff;border:2px solid #fecaca;box-shadow:0 0 0 2px rgba(220,38,38,.28);"
                : "background:#334155;color:#cbd5e1;";

        return `
          <td class="roster-shift-cell">
            <span
              class="shift-badge"
              ${editable
                ? `data-emp="${esc(emp.id)}"
                   data-day="${day}"
                   style="${shiftStyle}cursor:pointer;display:inline-block;min-width:44px;padding:7px 8px;border-radius:7px;font-size:14px;font-weight:800;"`
                : `style="${shiftStyle}display:inline-block;min-width:44px;padding:7px 8px;border-radius:7px;font-size:14px;font-weight:800;"`
              }
            >${esc(value)}</span>
          </td>
        `;
      }).join("");

      return `
        <tr>
          <th class="roster-day-cell">
            <b>${day}</b>
            <small>${weekday}</small>
          </th>
          ${cells}
        </tr>
      `;
    }).join("");

    if (editable) {
      targetBody.querySelectorAll("[data-emp]").forEach(el => {
        el.addEventListener("click", () => {
          changeShift(
            el.dataset.emp,
            Number(el.dataset.day)
          );
        });
      });
    }
  }

  // عرض الموظفين ومهامهم
  function renderEmployees(target) {
    if (!target) return;

    target.innerHTML = employees.map(emp => `
      <article class="emp" style="background:#101b30;border:1px solid #334155;border-radius:12px;padding:13px;">
        <b>${esc(emp.name)}</b>
        <div class="muted">${esc(emp.office)}</div>
        <p>${esc(emp.role)}</p>
        ${isManager ? `
          <button
            type="button"
            class="secondary"
            data-edit-employee="${esc(emp.id)}"
            style="margin-top:8px;width:100%;"
          >تعديل بيانات الموظف</button>
        ` : ""}
      </article>
    `).join("");

    if (isManager) {
      target.querySelectorAll("[data-edit-employee]").forEach(button => {
        button.addEventListener("click", () => {
          editEmployee(button.dataset.editEmployee);
        });
      });
    }
  }

  // تعديل اسم الموظف ومكتبه والمهام والبرامج المكلف بها
  async function editEmployee(employeeId) {
    const employee = employees.find(emp => emp.id === employeeId);
    if (!employee) return;

    const name = prompt("اسم الموظف:", employee.name || "");
    if (name === null) return;
    if (!name.trim()) {
      alert("اسم الموظف لا يمكن أن يكون فارغاً.");
      return;
    }

    const office = prompt(
      "المكتب (مكتب عدن أو مكتب لحج):",
      employee.office || "مكتب عدن"
    );
    if (office === null) return;
    if (!office.trim()) {
      alert("يرجى إدخال اسم المكتب.");
      return;
    }

    const role = prompt(
      "المهام والبرامج المكلف بها:",
      employee.role || ""
    );
    if (role === null) return;

    const { error } = await db
      .from("employees")
      .update({
        name: name.trim(),
        office: office.trim(),
        role: role.trim()
      })
      .eq("id", employeeId);

    if (error) {
      alert("تعذر تحديث بيانات الموظف: " + error.message);
      return;
    }

    await loadAll();
    alert("تم تحديث بيانات الموظف ونشرها في صفحة الموظفين.");
  }

  // تحديث قائمة اختيار الموظف في التعديل الشهري
  function renderBulkEmployees() {
    const select = $("bulkEmployee");
    if (!select) return;

    const previousValue = select.value;

    select.innerHTML = `
      <option value="">اختر الموظف</option>
      ${employees.map(emp => `
        <option value="${esc(emp.id)}">
          ${esc(emp.name)} — ${esc(emp.office)}
        </option>
      `).join("")}
    `;

    if (employees.some(emp => emp.id === previousValue)) {
      select.value = previousValue;
    }
  }

  // تعديل مناوبة يوم واحد
  async function changeShift(employeeId, day) {
    const month = $("month").value;

    const record = roster.find(item =>
      item.employee_id === employeeId &&
      Number(item.day) === day
    );

    const oldShift = record?.shift || "م";

    const nextShift = {
      "م": "ص",
      "ص": "off",
      "off": "م"
    }[oldShift] || "م";

    const { error } = await db
      .from("roster_entries")
      .upsert({
        month,
        employee_id: employeeId,
        day,
        shift: nextShift
      }, {
        onConflict: "month,employee_id,day"
      });

    if (error) {
      alert("تعذر حفظ المناوبة: " + error.message);
      return;
    }

    await loadAll();
  }

  // تعديل دوام الموظف طوال الشهر بضغطة واحدة
  async function applyBulkShift() {
    const employeeId = $("bulkEmployee")?.value;
    const shift = $("bulkShift")?.value;
    const month = $("month")?.value;
    const msg = $("bulkMsg");
    const button = $("applyBulkShift");

    if (!employeeId) {
      alert("يرجى اختيار الموظف أولاً.");
      return;
    }

    if (!shift || !month) {
      alert("يرجى اختيار المناوبة والشهر.");
      return;
    }

    const employee = employees.find(
      emp => emp.id === employeeId
    );

    if (!employee) {
      alert("لم يتم العثور على الموظف.");
      return;
    }

    const confirmed = confirm(
      `هل تريد تحويل أيام عمل ${employee.name} إلى ${
        shift === "م" ? "المناوبة المسائية" : "المناوبة الصباحية"
      } طوال شهر ${monthName(month)}؟\n\n` +
      "ستبقى أيام الإجازة المسجلة كما هي."
    );

    if (!confirmed) return;

    const totalDays = daysIn(month);
    const rows = [];

    // المحافظة على الإجازات فقط
    // وتحديث جميع أيام العمل الأخرى
    for (let day = 1; day <= totalDays; day++) {
      const existing = roster.find(item =>
        item.employee_id === employeeId &&
        Number(item.day) === day
      );

      if (existing?.shift === "off") {
        continue;
      }

      rows.push({
        month,
        employee_id: employeeId,
        day,
        shift
      });
    }

    if (!rows.length) {
      if (msg) {
        msg.textContent =
          "جميع أيام الشهر مسجلة كإجازات.";
      }
      return;
    }

    if (button) button.disabled = true;
    if (msg) msg.textContent = "جارٍ تحديث جدول الدوام...";

    try {
      const { error } = await db
        .from("roster_entries")
        .upsert(rows, {
          onConflict: "month,employee_id,day"
        });

      if (error) throw error;

      await loadAll();

      if (msg) {
        msg.textContent =
          `تم تحديث ${rows.length} يوم عمل بنجاح، مع المحافظة على الإجازات.`;
      }

    } catch (error) {
      if (msg) {
        msg.textContent =
          "تعذر تحديث الدوام: " + error.message;
      }

      console.error(error);

    } finally {
      if (button) button.disabled = false;
    }
  }

  // عرض إنجازات الموظفين
  function renderTasks() {
    const target = $("tasks");
    if (!target) return;

    target.innerHTML = tasks.length
      ? tasks.map(task => {
          const emp = employees.find(
            e => e.id === task.employee_id
          );

          return `
            <div class="emp" style="margin:8px 0">
              <b>${esc(emp?.name || "موظف")}</b>
              — ${esc(task.video_name)}

              <div class="muted">
                البرنامج: ${esc(task.program_name)}
                ·
                ${new Date(task.created_at).toLocaleString("ar")}
              </div>

              <div class="row" style="margin-top:8px">
                <span class="pill">
                  ${task.approved ? "تم الاعتماد" : "بانتظار المراجعة"}
                </span>

                ${!task.approved ? `
                  <button
                    data-approve="${esc(task.id)}"
                    style="width:auto"
                  >اعتماد الإنجاز</button>
                ` : ""}
              </div>
            </div>
          `;
        }).join("")
      : "<p class='muted'>لا توجد إنجازات مسجلة حتى الآن.</p>";

    target.querySelectorAll("[data-approve]").forEach(button => {
      button.addEventListener("click", async () => {
        const { error } = await db
          .from("tasks")
          .update({ approved: true })
          .eq("id", button.dataset.approve);

        if (error) {
          alert(error.message);
        } else {
          await loadAll();
        }
      });
    });
  }

  // تحديث واجهة النظام
  function render() {
    if (isManager) {
      if ($("noticeInput")) {
        $("noticeInput").value =
          typeof notice === "string"
            ? notice
            : JSON.stringify(notice);
      }

      renderRoster(
        $("rosterHead"),
        $("rosterBody"),
        $("month").value || currentMonth,
        true
      );

      renderEmployees($("employees"));
      renderBulkEmployees();
      renderTasks();

    } else {
      if ($("notice")) {
        $("notice").textContent =
          typeof notice === "string"
            ? notice
            : JSON.stringify(notice);
      }

      renderRoster(
        $("head"),
        $("body"),
        currentMonth,
        false
      );

      renderEmployees($("employees"));

      const employeeSelect = $("employee");

      if (employeeSelect) {
        employeeSelect.innerHTML = employees.map(emp => `
          <option value="${esc(emp.id)}">
            ${esc(emp.name)} — ${esc(emp.office)}
          </option>
        `).join("");
      }
    }
  }

  // الاشتراك في التحديثات المباشرة
  function subscribe() {
    if (liveChannel) return;

    const channelName = isManager
      ? "montage-live-manager"
      : "montage-live-employees";

    liveChannel = db.channel(channelName);

    [
      "employees",
      "roster_entries",
      "settings",
      "tasks"
    ].forEach(table => {
      liveChannel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table
        },
        () => {
          loadAll().catch(console.error);
        }
      );
    });

    liveChannel.subscribe(status => {
      const target = $("connection") || $("live");

      if (target) {
        target.textContent =
          status === "SUBSCRIBED"
            ? "متصل — التحديثات المباشرة مفعّلة"
            : "الاتصال: " + status;
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT"
      ) {
        console.error("Realtime error:", status);
      }
    });
  }

  // تشغيل صفحة الموظفين
  async function startEmployees() {
    setupEmployeeMonth();

    if ($("taskForm")) {
      $("taskForm").addEventListener("submit", async event => {
        event.preventDefault();

        $("formMsg").textContent = "جارٍ الإرسال...";

        const { error } = await db
          .from("tasks")
          .insert({
            employee_id: $("employee").value,
            video_name: $("video").value.trim(),
            program_name: $("program").value.trim()
          });

        $("formMsg").textContent = error
          ? "تعذر الإرسال: " + error.message
          : "تم إرسال إنجازك إلى المدير بنجاح.";

        if (!error) {
          $("taskForm").reset();
          await loadAll();
        }
      });
    }

    await loadAll();
    subscribe();
    watchEmployeeMonthRollover();
  }

  // تشغيل لوحة المدير
  async function startManager() {

    currentMonth = getCurrentMonth();
    if ($("month")) $("month").value = currentMonth;

    $("loginBtn").addEventListener("click", async () => {
      $("loginMsg").textContent = "جارٍ التحقق...";

      const { error } = await db.auth.signInWithPassword({
        email: $("email").value,
        password: $("password").value
      });

      if (error) {
        $("loginMsg").textContent =
          "تعذر الدخول: " + error.message;
        return;
      }

      await checkAdmin();
    });

    $("logout").addEventListener("click", async () => {
      await db.auth.signOut();
      location.reload();
    });

    $("month").addEventListener("change", async () => {
      currentMonth = $("month").value;
      await loadAll();
    });

    // زر التعديل الشهري
    if ($("applyBulkShift")) {
      $("applyBulkShift").addEventListener(
        "click",
        applyBulkShift
      );
    }

    // حفظ الملاحظة الرئيسية
    $("saveNotice").addEventListener("click", async () => {
      const { error } = await db
        .from("settings")
        .upsert({
          key: "fixed_notice",
          value: $("noticeInput").value
        }, {
          onConflict: "key"
        });

      if (error) {
        alert(error.message);
      } else {
        alert("تم حفظ التوجيهات ونشرها للموظفين.");
      }
    });

    // توليد جدول تلقائي
    $("generate").addEventListener("click", async () => {
      const month = $("month").value;
      const rows = [];

      employees.forEach((emp, index) => {
        for (let day = 1; day <= daysIn(month); day++) {
          const weekday = new Date(
            Number(month.slice(0, 4)),
            Number(month.slice(5, 7)) - 1,
            day
          ).getDay();

          const shift =
            weekday === 5 && (day + index) % 2 === 0
              ? "off"
              : day % 2 === 0
                ? "ص"
                : "م";

          rows.push({
            month,
            employee_id: emp.id,
            day,
            shift
          });
        }
      });

      const { error } = await db
        .from("roster_entries")
        .upsert(rows, {
          onConflict: "month,employee_id,day"
        });

      if (error) {
        alert(error.message);
      } else {
        await loadAll();
      }
    });

    // إضافة موظف
    $("addEmployee").addEventListener("click", async () => {
      const name = prompt("اسم الموظف:");
      if (!name) return;

      const office =
        prompt(
          "المكتب (مكتب عدن أو مكتب لحج):",
          "مكتب عدن"
        ) || "مكتب عدن";

      const role =
        prompt("المهام والبرامج:", "") || "";

      const id =
        "emp_" + crypto.randomUUID().slice(0, 8);

      const { error } = await db
        .from("employees")
        .insert({
          id,
          name,
          office,
          role
        });

      if (error) {
        alert(error.message);
      } else {
        await loadAll();
      }
    });

    await checkAdmin();

    db.auth.onAuthStateChange(() => {
      checkAdmin().catch(console.error);
    });
  }

  // التحقق من صلاحية المدير
  async function checkAdmin() {
    const {
      data: { user }
    } = await db.auth.getUser();

    if (!user) {
      $("loginBox").classList.remove("hidden");
      $("adminApp").classList.add("hidden");
      $("logout").classList.add("hidden");
      return;
    }

    const { data, error } = await db
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) {
      await db.auth.signOut();

      $("loginBox").classList.remove("hidden");
      $("adminApp").classList.add("hidden");
      $("logout").classList.add("hidden");

      $("loginMsg").textContent =
        "هذا الحساب غير مخوّل كمدير للنظام.";

      return;
    }

    $("loginBox").classList.add("hidden");
    $("adminApp").classList.remove("hidden");
    $("logout").classList.remove("hidden");

    try {
      await loadAll();
      subscribe();
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  }

  // بدء النظام
  if (isManager) {
    startManager().catch(error => {
      console.error(error);
    });
  } else {
    startEmployees().catch(error => {
      if ($("live")) {
        $("live").textContent = error.message;
      }
      console.error(error);
    });
  }

})();
