import { APP_NAME } from "./lib/app-info";

export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>{APP_NAME}</h1>
      <p>Nothing to see yet. The plan is in docs/plan.md; the spike comes first.</p>
    </main>
  );
}
