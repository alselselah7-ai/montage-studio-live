(() => {
  const cfg = window.APP_CONFIG || {};

  const ready =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR_");

  const $ = id => document.getElementById(id);

  if (!ready) {
    const msg = "يلزم أولاً إضافة رابط مشروع Supabase ومفتاح anon في ملف config.js.";

    if ($("connection")) $("connection").textContent = msg;
    if ($("live")) $("live").textContent = msg;
    if ($("loginMsg")) $("loginMsg").textContent = msg;
    if ($("notice")) $("notice").textContent = msg;

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
  let currentMonth = "2026-11";
  let notice = "";
  let liveChannel = null;

  const weekdays = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت"
  ];

  const monthName = m =>
    new Date(
      Number(m.slice(0, 4)),
      Number(m.slice(5, 7)) - 1,
      1
    ).toLocaleDateString("ar", {
      month: "long",
      year: "numeric"
    });

  const daysIn = m =>
    new Date(
      Number(m.slice(0, 4)),
      Number(m.slice(5, 7)),
      0
    ).getDate();

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));

  async function loadAll() {
    const [e, r, t, n] = await Promise.all([
      db.from("employees")
        .select("*")
        .eq("active", true)
        .order("name"),

      db.from("roster_entries")
        .select("*")
        .eq(
          "month",
          isManager ? ($("month").value || currentMonth) : currentMonth
        ),

      db.from("tasks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),

      db.from("settings")
        .select("value")
        .eq("key", "fixed_notice")
        .maybeSingle()
    ]);

    for (const x of [e, r, t, n]) {
      if (x.error) throw x.error;
    }

    employees = e.data || [];
    roster = r.data || [];
    tasks = t.data || [];
    notice = n.data?.value || "";

    render();
  }

  function renderRoster(targetHead, targetBody, month, editable) {
    if (!targetHead || !targetBody) return;

    const count = daysIn(month);

    targetHead.innerHTML = `
      <tr>
        <th>م</th>
        <th class="name">الموظف / المكتب</th>
        ${Array.from({ length: count }, (_, i) => `
          <th>
            ${i + 1}
            <br>
            <small>
              ${weekdays[
                new Date(
                  Number(month.slice(0, 4)),
                  Number(month.slice(5, 7)) - 1,
                  i + 1
                ).getDay()
              ].slice(0, 1)}
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
          const d = j + 1;

          const rec = roster.find(x =>
            x.employee_id === emp.id &&
            x.day === d
          );

          const val = rec?.shift || "—";

          const cls =
            val === "ص" ? "shift-s" :
            val === "م" ? "shift-m" :
            val === "off" ? "shift-off" : "";

          return `
            <td class="${editable ? "" : "day"}">
              <span
                class="${cls}"
                ${editable
                  ? `data-emp="${esc(emp.id)}" data-day="${d}"
                     style="cursor:pointer;padding:5px 7px;border-radius:6px"`
                  : `style="padding:5px 7px;border-radius:6px"`
                }
              >${esc(val)}</span>
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

  function renderEmployees(target) {
    if (!target) return;

    target.innerHTML = employees.map(e => `
      <article class="emp">
        <b>${esc(e.name)}</b>
        <div class="muted">${esc(e.office)}</div>
        <p>${esc(e.role)}</p>
      </article>
    `).join("");
  }

  function renderTasks() {
    if (!$("tasks")) return;

    $("tasks").innerHTML = tasks.length
      ? tasks.map(t => {
          const emp = employees.find(e => e.id === t.employee_id);

          return `
            <div class="emp" style="margin:8px 0">
              <b>${esc(emp?.name || "موظف")}</b>
              — ${esc(t.video_name)}

              <div class="muted">
                البرنامج: ${esc(t.program_name)}
                · ${new Date(t.created_at).toLocaleString("ar")}
              </div>

              <div class="row" style="margin-top:8px">
                <span class="pill">
                  ${t.approved ? "تم الاعتماد" : "بانتظار المراجعة"}
                </span>

                ${!t.approved
                  ? `<button data-approve="${t.id}" style="width:auto">
                       اعتماد الإنجاز
                     </button>`
                  : ""
                }
              </div>
            </div>
          `;
        }).join("")
      : "<p class='muted'>لا توجد إنجازات مسجلة حتى الآن.</p>";

    $("tasks").querySelectorAll("[data-approve]").forEach(b => {
      b.addEventListener("click", async () => {
        const { error } = await db
          .from("tasks")
          .update({ approved: true })
          .eq("id", b.dataset.approve);

        if (error) {
          alert(error.message);
        } else {
          await loadAll();
        }
      });
    });
  }

  function render() {
    if (isManager) {
      if ($("noticeInput")) {
        $("noticeInput").value =
          typeof notice === "string" ? notice : JSON.stringify(notice);
      }

      renderRoster(
        $("rosterHead"),
        $("rosterBody"),
        $("month").value || currentMonth,
        true
      );

      renderEmployees($("employees"));
      renderTasks();

      // تحديث قائمة الموظفين في أداة تعديل الدوام الشهري
      if ($("bulkEmployee")) {
        const selected = $("bulkEmployee").value;

        $("bulkEmployee").innerHTML =
          '<option value="">اختر الموظف</option>' +
          employees.map(e => `
            <option value="${esc(e.id)}">
              ${esc(e.name)} — ${esc(e.office)}
            </option>
          `).join("");

        if (employees.some(e => e.id === selected)) {
          $("bulkEmployee").value = selected;
        }
      }

    } else {
      $("notice").textContent =
        typeof notice === "string" ? notice : JSON.stringify(notice);

      const monthSelect = $("month");

      if (monthSelect && !monthSelect.options.length) {
        const now = new Date();

        for (let i = -1; i < 4; i++) {
          const d = new Date(
            now.getFullYear(),
            now.getMonth() + i,
            1
          );

          const v =
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

          monthSelect.add(
            new Option(monthName(v), v)
          );
        }

        monthSelect.value =
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

        currentMonth = monthSelect.value;
      }

      renderRoster(
        $("head"),
        $("body"),
        currentMonth,
        false
      );

      renderEmployees($("employees"));

      $("employee").innerHTML = employees.map(e => `
        <option value="${esc(e.id)}">
          ${esc(e.name)} — ${esc(e.office)}
        </option>
      `).join("");
    }
  }

  async function changeShift(emp, day) {
    const old =
      roster.find(x =>
        x.employee_id === emp && x.day === day
      )?.shift || "م";

    const next = {
      "م": "ص",
      "ص": "off",
      "off": "م"
    }[old] || "م";

    const { error } = await db
      .from("roster_entries")
      .upsert({
        month: $("month").value,
        employee_id: emp,
        day,
        shift: next
      }, {
        onConflict: "month,employee_id,day"
      });

    if (error) {
      alert("تعذر حفظ المناوبة: " + error.message);
    } else {
      await loadAll();
    }
  }

  // تعديل جميع أيام العمل لموظف واحد في الشهر المحدد
  // أيام الإجازة off لا تتغير
  async function applyBulkShift() {
    const employeeId = $("bulkEmployee").value;
    const shift = $("bulkShift").value;
    const month = $("month").value;
    const msg = $("bulkMsg");

    if (!employeeId) {
      alert("يرجى اختيار الموظف أولاً.");
      return;
    }

    if (!month) {
      alert("يرجى اختيار الشهر أولاً.");
      return;
    }

    const workingDays = roster.filter(r =>
      r.employee_id === employeeId &&
      r.month === month &&
      r.shift !== "off"
    );

    if (!workingDays.length) {
      msg.textContent =
        "لا توجد أيام عمل مسجلة لهذا الموظف في الشهر المحدد.";
      return;
    }

    const rows = workingDays.map(r => ({
      month: month,
      employee_id: employeeId,
      day: r.day,
      shift: shift
    }));

    msg.textContent = "جارٍ تحديث الدوام...";

    $("applyBulkShift").disabled = true;

    const { error } = await db
      .from("roster_entries")
      .upsert(rows, {
        onConflict: "month,employee_id,day"
      });

    $("applyBulkShift").disabled = false;

    if (error) {
      msg.textContent = "تعذر التعديل: " + error.message;
      return;
    }

    msg.textContent =
      `تم تعديل ${rows.length} يوم عمل بنجاح، مع الحفاظ على أيام الإجازة.`;

    await loadAll();
  }

  function subscribe() {
    // منع إنشاء اشتراك مكرر
    if (liveChannel) return;

    const channelName = isManager
      ? "montage-live-manager"
      : "montage-live-employees";

    liveChannel = db.channel(channelName);

    liveChannel
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "employees"
      }, () => loadAll())

      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "roster_entries"
      }, () => loadAll())

      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "settings"
      }, () => loadAll())

      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "tasks"
      }, () => loadAll())

      .subscribe(status => {
        const el = $("connection") || $("live");

        if (el) {
          el.textContent =
            status === "SUBSCRIBED"
              ? "متصل — التحديثات المباشرة مفعّلة"
              : "الاتصال: " + status;
        }

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT"
        ) {
          console.error(
            "Realtime connection error:",
            status
          );
        }
      });
  }

  async function startEmployees() {
    $("month").addEventListener("change", async () => {
      currentMonth = $("month").value;
      await loadAll();
    });

    $("taskForm").addEventListener("submit", async ev => {
      ev.preventDefault();

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

    await loadAll();
    subscribe();
  }

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
      $("bulkMsg").textContent = "";
      await loadAll();
    });

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

    $("generate").addEventListener("click", async () => {
      const m = $("month").value;
      const rows = [];

      employees.forEach((e, idx) => {
        for (let d = 1; d <= daysIn(m); d++) {
          const weekday = new Date(
            Number(m.slice(0, 4)),
            Number(m.slice(5, 7)) - 1,
            d
          ).getDay();

          const shift =
            weekday === 5 && (d + idx) % 2 === 0
              ? "off"
              : d % 2 === 0
                ? "ص"
                : "م";

          rows.push({
            month: m,
            employee_id: e.id,
            day: d,
            shift: shift
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
        $("bulkMsg").textContent = "";
        await loadAll();
      }
    });

    // ربط زر تعديل الدوام الشهري
    $("applyBulkShift").addEventListener(
      "click",
      applyBulkShift
    );

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
      checkAdmin();
    });
  }

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
    } catch (e) {
      alert(e.message);
    }
  }

  if (isManager) {
    startManager().catch(e => console.error(e));
  } else {
    startEmployees().catch(e => {
      if ($("live")) {
        $("live").textContent = e.message;
      }
    });
  }
})();
