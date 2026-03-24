import DashboardSidebar from "@/components/layout/DashboardSidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full bg-[#FAFAFA] p-3 sm:p-4 lg:p-6 gap-3 sm:gap-4 lg:gap-6">
      <DashboardSidebar />
      <main className="flex-1 flex flex-col min-w-0 bg-white rounded-xl sm:rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {children}
      </main>
    </div>
  );
}
