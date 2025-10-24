import AdminCompanies from '../components/Admin/AdminCompanies';
import AdminUsers from '../components/Admin/AdminUsers';
import AdminCoupons from '../components/Admin/AdminCoupons';
import { useQuery } from '@tanstack/react-query';
import { fetchCompanies, fetchUsers } from '../lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';

export default function AdminPanel() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin', 'companies'], queryFn: fetchCompanies });
  const companies = ((data && (data as Record<string, unknown>).data) as Array<Record<string, unknown>> | undefined) ?? [];
  const usersQ = useQuery({ queryKey: ['admin', 'users'], queryFn: fetchUsers });
  const users = ((usersQ.data && (usersQ.data as Record<string, unknown>).data) as Array<Record<string, unknown>> | undefined) ?? [];
  const usersLoading = usersQ.isLoading;
  const usersError = !!usersQ.isError;

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Admin Paneli</h2>

      <Tabs defaultValue="companies">
        <TabsList>
          <TabsTrigger value="companies">Firmalar</TabsTrigger>
          <TabsTrigger value="users">Kullanıcılar</TabsTrigger>
          <TabsTrigger value="admin_coupons">Kuponlar (Admin)</TabsTrigger>
        </TabsList>

        <TabsContent value="companies">
          <AdminCompanies companies={companies} companiesLoading={isLoading} companiesError={isError} users={users} />
        </TabsContent>

        <TabsContent value="users">
          <AdminUsers companies={companies} companiesLoading={isLoading} companiesError={isError} users={users} usersLoading={usersLoading} usersError={usersError} />
        </TabsContent>

        <TabsContent value="admin_coupons">
          <AdminCoupons />
        </TabsContent>
      </Tabs>
    </div>
  );
}
