import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckCircle2, Clock3, Filter, Search, Settings2 } from "lucide-react";
import "./styles.css";

const tickets = [
  { id: "SUP-1042", team: "Billing", priority: "High", status: "At risk", owner: "Mina", age: "2h 14m" },
  { id: "SUP-1041", team: "Platform", priority: "Medium", status: "Open", owner: "Jon", age: "48m" },
  { id: "SUP-1039", team: "Success", priority: "Low", status: "Waiting", owner: "Ari", age: "19m" },
  { id: "SUP-1038", team: "Billing", priority: "High", status: "Resolved", owner: "Dee", age: "8m" },
];

function App() {
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("All");
  const [selected, setSelected] = useState(tickets[0]);

  const filtered = useMemo(() => {
    return tickets.filter((ticket) => {
      const matchesTeam = team === "All" || ticket.team === team;
      const matchesQuery = `${ticket.id} ${ticket.team} ${ticket.owner} ${ticket.status}`
        .toLowerCase()
        .includes(query.toLowerCase());
      return matchesTeam && matchesQuery;
    });
  }, [query, team]);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Workspace">
        <div className="brand">Queue</div>
        <nav>
          <a className="active" href="#overview">Overview</a>
          <a href="#tickets">Tickets</a>
          <a href="#sla">SLA</a>
          <a href="#settings">Settings</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Support operations</p>
            <h1>Queue health</h1>
          </div>
          <button className="icon-text" type="button">
            <Settings2 size={16} aria-hidden="true" />
            Tune view
          </button>
        </header>

        <section className="metrics" aria-label="Queue metrics">
          <Metric label="Open tickets" value="128" icon={<Clock3 size={18} />} />
          <Metric label="SLA healthy" value="91%" icon={<CheckCircle2 size={18} />} />
          <Metric label="Median response" value="14m" icon={<Clock3 size={18} />} />
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-toolbar">
              <label className="search">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">Search tickets</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tickets" />
              </label>
              <label className="select-label">
                <Filter size={16} aria-hidden="true" />
                <select value={team} onChange={(event) => setTeam(event.target.value)}>
                  <option>All</option>
                  <option>Billing</option>
                  <option>Platform</option>
                  <option>Success</option>
                </select>
              </label>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Team</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ticket) => (
                    <tr key={ticket.id} className={selected.id === ticket.id ? "selected" : ""} onClick={() => setSelected(ticket)}>
                      <td>{ticket.id}</td>
                      <td>{ticket.team}</td>
                      <td>{ticket.priority}</td>
                      <td><span className={`status ${ticket.status.toLowerCase().replace(" ", "-")}`}>{ticket.status}</span></td>
                      <td>{ticket.owner}</td>
                      <td>{ticket.age}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="detail" aria-label="Ticket detail">
            <p className="eyebrow">Selected ticket</p>
            <h2>{selected.id}</h2>
            <dl>
              <div><dt>Team</dt><dd>{selected.team}</dd></div>
              <div><dt>Owner</dt><dd>{selected.owner}</dd></div>
              <div><dt>Priority</dt><dd>{selected.priority}</dd></div>
              <div><dt>Status</dt><dd>{selected.status}</dd></div>
            </dl>
            <button type="button">Open ticket</button>
          </aside>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, icon }) {
  return (
    <article className="metric">
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
