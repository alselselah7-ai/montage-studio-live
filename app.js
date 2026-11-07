
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

  let currentMonth = new Date().toISOString().slice(0, 7);

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

  // تجهيز الشهر في صفحة الموظفين
  function setupEmployeeMonth() {
    const select = $("month");
    if (!select) return;

    if (!select.options.length) {
      const now = new Date();

      for (let i = -1; i < 5; i++) {
        const date = new Date(
          now.getFullYear(),
          now.getMonth() + i,
          1
        );

        const value =
          `${date.getFullYear()}-${String(
            date.getMonth() + 1
          ).padStart(2, "0")}`;

        select.add(new Option(monthName(value), value));
      }
    }

    if (select.value) {
      currentMonth = select.value;
    } else {
      select.value = currentMonth;
    }
  }

  // تحميل بيانات النظام
  async function loadAll() {
    const month = isManager
      ? ($("month")?.value || currentMonth)
      : currentMonth;

    const [e, r, t, n] = await Promise.all([
      db.from("employees")
        .select("*")
        .eq("active", true)
        .order("name"),

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

    for (const result of [e, r, t, n]) {
      if (result.error) throw result.error;
    }

    employees = e.data || [];
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

    targetHead.innerHTML = `
      <tr>
        <th>م</th>
        <th class="name">الموظف / المكتب</th>

        ${Array.from({ length: count }, (_, i) => `
          <th>
            ${i+1}
<small style="font-size:10px;color:#a7c5e8;font-weight:600">
  ${weekdays[
    new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)) - 1,
      i + 1
    ).getDay()
  ]}
</small>
          </th>
        `).join("")}
      </tr>
    `;

    targetBody.innerHTML = employees.map((emp, i) => `
      <tr>
        <td>${i + 1}</td>

        <td class="name">
          <b>${esc(emp.name)}</b>
          <br>
          <small>${esc(emp.office)}</small>
        </td>

        ${Array.from({ length: count }, (_, j) => {
          const day = j + 1;

          const record = roster.find(item =>
            item.employee_id === emp.id &&
            Number(item.day) === day
          );

          const value = record?.shift || "—";

          const cls =
            value === "ص" ? "shift-s" :
            value === "م" ? "shift-m" :
            value === "off" ? "shift-off" : "";

          return `
            <td class="${editable ? "" : "day"}">
              <span
                class="${cls}"
                ${editable
                  ? `data-emp="${esc(emp.id)}"
                     data-day="${day}"
                     style="cursor:pointer;padding:5px 7px;border-radius:6px"`
                  : `style="padding:5px 7px;border-radius:6px"`
                }
              >${esc(value)}</span>
            </td>
          `;
        }).join("")}
      </tr>
    `).join("");

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
      <article class="emp">
        <b>${esc(emp.name)}</b>
        <div class="muted">${esc(emp.office)}</div>
        <p>${esc(emp.role)}</p>
      </article>
    `).join("");
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

    if ($("month")) {
      $("month").addEventListener("change", async () => {
        currentMonth = $("month").value;
        await loadAll();
      });
    }

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
  }

  // تشغيل لوحة المدير
  async function startManager() {

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
