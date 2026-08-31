import NavBar from "@/app/NavBar";

export default function AppLayout({ children }) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black print:bg-white">
      <div className="mx-auto w-full max-w-5xl px-6 pt-10 print:hidden">
        <NavBar />
      </div>
      {children}
    </div>
  );
}
