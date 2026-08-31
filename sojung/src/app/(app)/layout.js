import NavBar from "@/app/NavBar";

export default function AppLayout({ children }) {
  return (
    <div className="flex flex-1 bg-white print:bg-white">
      <aside className="w-60 shrink-0 border-r border-zinc-200 bg-white px-4 py-6 print:hidden">
        <NavBar />
      </aside>
      <main className="min-w-0 flex-1 pt-10">{children}</main>
    </div>
  );
}
