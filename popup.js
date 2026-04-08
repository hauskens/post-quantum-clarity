let currentTab = "unsafe";
let lastStats = { safe: 0, unsafe: 0, requests: [] };

function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  const filtered = lastStats.requests.filter((r) =>
    currentTab === "all" ? true : currentTab === "safe" ? r.safe : !r.safe
  );
  for (const r of filtered.slice().reverse()) {
    const li = document.createElement("li");
    li.className = r.safe ? "safe" : "unsafe";
    const url = document.createElement("span");
    url.className = "url";
    url.textContent = (r.safe ? "✓ " : "✗ ") + r.url;
    const group = document.createElement("span");
    group.className = "group";
    group.textContent = r.group || "(unknown group)";
    li.appendChild(url);
    li.appendChild(group);
    list.appendChild(li);
  }

  for (const el of document.querySelectorAll(".tab")) {
    el.classList.toggle("active", el.dataset.tab === currentTab);
  }
}

async function render() {
  lastStats = (await browser.runtime.sendMessage({ type: "getStats" })) || {
    safe: 0, unsafe: 0, requests: [],
  };
  const total = lastStats.safe + lastStats.unsafe;
  document.getElementById("safe").textContent = lastStats.safe;
  document.getElementById("unsafe").textContent = lastStats.unsafe;
  document.getElementById("total").textContent = total;

  const dot = document.getElementById("dot");
  const label = document.getElementById("label");
  dot.className = "dot ";
  if (total === 0) {
    dot.className += "gray";
    label.textContent = "No HTTPS traffic seen";
  } else if (lastStats.unsafe === 0) {
    dot.className += "green";
    label.textContent = "All requests are post-quantum safe";
  } else if (lastStats.safe === 0) {
    dot.className += "red";
    label.textContent = "No requests are post-quantum safe";
  } else {
    dot.className += "yellow";
    label.textContent = "Some requests are post-quantum safe";
  }

  const groupsEl = document.getElementById("groups");
  groupsEl.innerHTML = "";
  const seen = new Map(); // name -> {safe, count}
  for (const r of lastStats.requests) {
    const name = r.group || "(unknown)";
    const entry = seen.get(name) || { safe: r.safe, count: 0 };
    entry.count++;
    seen.set(name, entry);
  }
  if (seen.size > 0) {
    groupsEl.appendChild(document.createTextNode("Detected groups: "));
    for (const [name, { safe, count }] of seen) {
      const chip = document.createElement("span");
      chip.className = "chip " + (safe ? "safe" : "unsafe");
      chip.textContent = `${name} ×${count}`;
      groupsEl.appendChild(chip);
    }
  }

  renderList();
}

for (const el of document.querySelectorAll(".tab")) {
  el.addEventListener("click", () => {
    currentTab = el.dataset.tab;
    renderList();
  });
}

render();
