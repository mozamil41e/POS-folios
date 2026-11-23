import { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Edit3,
  KeyRound,
  Lock,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  Language,
  ManagedUser,
  PermissionKey,
  RoleRecord,
} from '../types';
import { ALL_PERMISSION_KEYS, PERMISSION_GROUPS } from '../permissions';
import { formatDateTime } from '../i18n';
import { TablePagination, useTablePagination } from './TablePagination';

interface UsersPermissionsViewProps {
  lang: Language;
  currentUser: AuthUser;
  users: ManagedUser[];
  roles: RoleRecord[];
  pageSize: number;
  onCreateUser: (payload: {
    full_name: string;
    email: string;
    phone: string;
    password: string;
    role_id: number;
    is_active: boolean;
  }) => Promise<boolean>;
  onUpdateUser: (
    id: number,
    payload: {
      full_name: string;
      email: string;
      phone: string;
      password?: string;
      role_id: number;
      is_active: boolean;
    }
  ) => Promise<boolean>;
  onDeleteUser: (id: number) => Promise<boolean>;
  onCreateRole: (payload: {
    name_ar: string;
    name_en: string;
    description_ar: string;
    description_en: string;
    permissions: PermissionKey[];
  }) => Promise<RoleRecord | null>;
  onUpdateRole: (
    id: number,
    payload: {
      name_ar: string;
      name_en: string;
      description_ar: string;
      description_en: string;
      permissions: PermissionKey[];
    }
  ) => Promise<boolean>;
  onDeleteRole: (id: number) => Promise<boolean>;
}

export function UsersPermissionsView({
  lang,
  currentUser,
  users,
  roles,
  pageSize,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
}: UsersPermissionsViewProps) {
  const isAr = lang === 'ar';
  const totalAvailablePerms = ALL_PERMISSION_KEYS.length;

  const [subTab, setSubTab] = useState<'users' | 'roles'>('users');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // User Modal state
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    role_id: roles[0]?.id ?? 0,
    is_active: true,
  });

  // Role Editor state
  const [selectedRoleId, setSelectedRoleId] = useState<number>(roles[0]?.id ?? 0);
  const [roleDraft, setRoleDraft] = useState<{
    name_ar: string;
    name_en: string;
    description_ar: string;
    description_en: string;
    permissions: PermissionKey[];
  }>({
    name_ar: '',
    name_en: '',
    description_ar: '',
    description_en: '',
    permissions: [],
  });
  const [savingRole, setSavingRole] = useState(false);

  // Create Role Modal state
  const [showNewRoleModal, setShowNewRoleModal] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState<{
    name_ar: string;
    name_en: string;
    description_ar: string;
    description_en: string;
    permissions: PermissionKey[];
  }>({
    name_ar: '',
    name_en: '',
    description_ar: '',
    description_en: '',
    permissions: ['pos.access', 'sales.view', 'inventory.view'],
  });

  // Delete confirmation modal
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: 'user'; id: number; label: string }
    | { kind: 'role'; id: number; label: string }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  // Sync selectedRoleId when roles update
  useEffect(() => {
    if (roles.length === 0) return;
    const exists = roles.some((r) => r.id === selectedRoleId);
    if (!exists) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null,
    [roles, selectedRoleId]
  );

  useEffect(() => {
    if (!selectedRole) return;
    setRoleDraft({
      name_ar: selectedRole.name_ar,
      name_en: selectedRole.name_en,
      description_ar: selectedRole.description_ar,
      description_en: selectedRole.description_en,
      permissions: [...selectedRole.permissions],
    });
  }, [selectedRole]);

  const metrics = useMemo(() => {
    const activeCount = users.filter((u) => u.is_active === 1).length;
    const inactiveCount = users.length - activeCount;
    return {
      totalUsers: users.length,
      activeCount,
      inactiveCount,
      totalRoles: roles.length,
    };
  }, [users, roles]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && String(u.role_id) !== roleFilter) return false;
      if (statusFilter === 'active' && u.is_active !== 1) return false;
      if (statusFilter === 'inactive' && u.is_active !== 0) return false;
      if (!q) return true;
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        u.role_name_ar.toLowerCase().includes(q) ||
        u.role_name_en.toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter, statusFilter]);

  const {
    currentPage,
    setPage,
    totalPages,
    totalItems,
    startItem,
    endItem,
    pagedItems: pagedUsers,
  } = useTablePagination(filteredUsers, pageSize, `${search}|${roleFilter}|${statusFilter}`);

  const openAddUser = () => {
    const defaultCashier = roles.find((r) => r.slug === 'cashier') ?? roles[0];
    setEditingUser(null);
    setUserForm({
      full_name: '',
      email: '',
      phone: '',
      password: '',
      role_id: defaultCashier?.id ?? 0,
      is_active: true,
    });
    setShowUserModal(true);
  };

  const openEditUser = (u: ManagedUser) => {
    setEditingUser(u);
    setUserForm({
      full_name: u.full_name,
      email: u.email,
      phone: u.phone || '',
      password: '',
      role_id: u.role_id || roles[0]?.id || 0,
      is_active: u.is_active === 1,
    });
    setShowUserModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUser(true);
    try {
      let ok = false;
      if (editingUser) {
        ok = await onUpdateUser(editingUser.id, {
          full_name: userForm.full_name,
          email: userForm.email,
          phone: userForm.phone,
          password: userForm.password.trim() || undefined,
          role_id: Number(userForm.role_id),
          is_active: userForm.is_active,
        });
      } else {
        ok = await onCreateUser({
          full_name: userForm.full_name,
          email: userForm.email,
          phone: userForm.phone,
          password: userForm.password,
          role_id: Number(userForm.role_id),
          is_active: userForm.is_active,
        });
      }
      if (ok) {
        setShowUserModal(false);
      }
    } finally {
      setSavingUser(false);
    }
  };

  const handleQuickToggleStatus = async (u: ManagedUser) => {
    await onUpdateUser(u.id, {
      full_name: u.full_name,
      email: u.email,
      phone: u.phone,
      role_id: u.role_id,
      is_active: u.is_active !== 1,
    });
  };

  const toggleDraftPermission = (perm: PermissionKey) => {
    if (selectedRole?.slug === 'admin') return;
    setRoleDraft((prev) => {
      const exists = prev.permissions.includes(perm);
      return {
        ...prev,
        permissions: exists
          ? prev.permissions.filter((p) => p !== perm)
          : [...prev.permissions, perm],
      };
    });
  };

  const toggleDraftGroup = (groupPerms: PermissionKey[]) => {
    if (selectedRole?.slug === 'admin') return;
    setRoleDraft((prev) => {
      const allSelected = groupPerms.every((p) => prev.permissions.includes(p));
      if (allSelected) {
        return {
          ...prev,
          permissions: prev.permissions.filter((p) => !groupPerms.includes(p)),
        };
      }
      const next = new Set<PermissionKey>([...prev.permissions, ...groupPerms]);
      return {
        ...prev,
        permissions: Array.from(next),
      };
    });
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;
    setSavingRole(true);
    try {
      await onUpdateRole(selectedRole.id, {
        name_ar: roleDraft.name_ar,
        name_en: roleDraft.name_en,
        description_ar: roleDraft.description_ar,
        description_en: roleDraft.description_en,
        permissions: roleDraft.permissions,
      });
    } finally {
      setSavingRole(false);
    }
  };

  const handleCreateNewRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingRole(true);
    try {
      const created = await onCreateRole({
        name_ar: newRoleForm.name_ar,
        name_en: newRoleForm.name_en || newRoleForm.name_ar,
        description_ar: newRoleForm.description_ar,
        description_en: newRoleForm.description_en || newRoleForm.description_ar,
        permissions: newRoleForm.permissions,
      });
      if (created) {
        setShowNewRoleModal(false);
        setSelectedRoleId(created.id);
        setNewRoleForm({
          name_ar: '',
          name_en: '',
          description_ar: '',
          description_en: '',
          permissions: ['pos.access', 'sales.view', 'inventory.view'],
        });
      }
    } finally {
      setCreatingRole(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      let ok = false;
      if (confirmDelete.kind === 'user') {
        ok = await onDeleteUser(confirmDelete.id);
      } else {
        ok = await onDeleteRole(confirmDelete.id);
      }
      if (ok) {
        setConfirmDelete(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  const selectedFormRole = roles.find((r) => r.id === Number(userForm.role_id));

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isAr ? 'إجمالي المستخدمين' : 'Total Users'}
          </div>
          <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-1">
            {metrics.totalUsers}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isAr ? 'حسابات نشطة' : 'Active Accounts'}
          </div>
          <div className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
            {metrics.activeCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isAr ? 'حسابات معطلة' : 'Inactive Accounts'}
          </div>
          <div className="text-xl font-bold tabular-nums text-slate-700 dark:text-slate-300 mt-1">
            {metrics.inactiveCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isAr ? 'الأدوار الوظيفية' : 'Configured Roles'}
          </div>
          <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-1">
            {metrics.totalRoles}
          </div>
        </div>
      </div>

      {/* Sub-navigation & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setSubTab('users')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              subTab === 'users'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            {isAr ? 'قائمة المستخدمين' : 'Users Directory'}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('roles')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              subTab === 'roles'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            {isAr ? 'الأدوار والصلاحيات' : 'Roles & Permissions'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {subTab === 'users' ? (
            <button
              type="button"
              onClick={openAddUser}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {isAr ? 'إضافة مستخدم' : 'Add User'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewRoleModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {isAr ? 'إنشاء دور جديد' : 'New Role'}
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: Users Directory */}
      {subTab === 'users' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          {/* Toolbar */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={
                  isAr
                    ? 'بحث بالاسم، البريد، الجوال أو الدور...'
                    : 'Search by name, email, phone, or role...'
                }
                className="w-full ps-9 pe-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              >
                <option value="all">{isAr ? 'كل الأدوار' : 'All Roles'}</option>
                {roles.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {isAr ? r.name_ar : r.name_en} ({r.permissions.length})
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as 'all' | 'active' | 'inactive');
                  setPage(1);
                }}
                className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              >
                <option value="all">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
                <option value="active">{isAr ? 'نشط فقط' : 'Active Only'}</option>
                <option value="inactive">{isAr ? 'معطل فقط' : 'Inactive Only'}</option>
              </select>
            </div>
          </div>

          {/* Users Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="text-start py-3 px-4 font-semibold">
                    {isAr ? 'المستخدم' : 'User'}
                  </th>
                  <th className="text-start py-3 px-4 font-semibold">
                    {isAr ? 'البريد الإلكتروني والجوال' : 'Email & Phone'}
                  </th>
                  <th className="text-start py-3 px-4 font-semibold">
                    {isAr ? 'الدور وعدد الصلاحيات' : 'Role & Permissions'}
                  </th>
                  <th className="text-start py-3 px-4 font-semibold">
                    {isAr ? 'الحالة' : 'Status'}
                  </th>
                  <th className="text-start py-3 px-4 font-semibold">
                    {isAr ? 'آخر دخول' : 'Last Login'}
                  </th>
                  <th className="text-end py-3 px-4 font-semibold">
                    {isAr ? 'إجراءات' : 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {pagedUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-10 text-center text-slate-500 dark:text-slate-400"
                    >
                      {isAr ? 'لا يوجد مستخدمون مطابقون للبحث.' : 'No matching users found.'}
                    </td>
                  </tr>
                ) : (
                  pagedUsers.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    return (
                      <tr
                        key={u.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-950/40 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{u.full_name}</span>
                            {isSelf && (
                              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                                ({isAr ? 'أنت' : 'You'})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div dir="ltr" className="font-mono text-slate-800 dark:text-slate-200 text-start">
                            {u.email}
                          </div>
                          {u.phone && (
                            <div dir="ltr" className="font-mono text-[11px] text-slate-500 dark:text-slate-400 text-start">
                              {u.phone}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {isAr ? u.role_name_ar : u.role_name_en}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {isAr
                              ? `${u.permissions_count} من ${totalAvailablePerms} صلاحية`
                              : `${u.permissions_count} / ${totalAvailablePerms} permissions`}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-xs font-semibold ${
                              u.is_active === 1
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {u.is_active === 1
                              ? isAr
                                ? 'نشط'
                                : 'Active'
                              : isAr
                              ? 'معطل'
                              : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400 tabular-nums">
                          {u.last_login_at
                            ? formatDateTime(u.last_login_at, lang)
                            : isAr
                            ? 'لم يسجل بعد'
                            : 'Never'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditUser(u)}
                              title={isAr ? 'تعديل المستخدم' : 'Edit User'}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>{isAr ? 'تعديل' : 'Edit'}</span>
                            </button>
                            {!isSelf && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleQuickToggleStatus(u)}
                                  title={
                                    u.is_active === 1
                                      ? isAr
                                        ? 'تعطيل الحساب'
                                        : 'Deactivate'
                                      : isAr
                                      ? 'تفعيل الحساب'
                                      : 'Activate'
                                  }
                                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                  {u.is_active === 1 ? (
                                    <UserX className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                  ) : (
                                    <UserCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDelete({
                                      kind: 'user',
                                      id: u.id,
                                      label: u.full_name,
                                    })
                                  }
                                  title={isAr ? 'حذف المستخدم' : 'Delete User'}
                                  className="p-1.5 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            lang={lang}
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            startItem={startItem}
            endItem={endItem}
            onPageChange={setPage}
          />
        </div>
      )}

      {/* TAB 2: Roles & Permissions Matrix */}
      {subTab === 'roles' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Roles Sidebar */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAr ? 'الأدوار المتاحة' : 'Available Roles'}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {roles.length}
              </span>
            </div>

            <div className="space-y-2">
              {roles.map((r) => {
                const active = selectedRole?.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRoleId(r.id)}
                    className={`w-full text-start p-3 rounded-xl border transition-colors ${
                      active
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-700/60 dark:border-emerald-500/60'
                        : 'bg-slate-50/60 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        {r.slug === 'admin' ? (
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                        ) : (
                          <KeyRound className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        )}
                        {isAr ? r.name_ar : r.name_en}
                      </span>
                      <span className="text-[11px] font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {r.permissions.length}/{totalAvailablePerms}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="truncate">
                        {isAr ? r.description_ar || r.name_en : r.description_en || r.name_ar}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {isAr ? `${r.users_count ?? 0} مستخدم` : `${r.users_count ?? 0} users`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Role Permissions Matrix */}
          {selectedRole && (
            <form
              onSubmit={handleSaveRole}
              className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>{isAr ? selectedRole.name_ar : selectedRole.name_en}</span>
                    <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                      ({roleDraft.permissions.length} / {totalAvailablePerms}{' '}
                      {isAr ? 'صلاحية' : 'permissions'})
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {isAr
                      ? 'تحكم في الصلاحيات الممنوحة لهذا الدور؛ أي تعديل ينعكس فوراً على جميع المستخدمين التابعين له.'
                      : 'Configure exact permissions for this role. Changes apply immediately to all assigned users.'}
                  </p>
                </div>

                {selectedRole.slug !== 'admin' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setRoleDraft((prev) => ({
                          ...prev,
                          permissions: [...ALL_PERMISSION_KEYS],
                        }))
                      }
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {isAr ? 'تحديد الكل' : 'Select All'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoleDraft((prev) => ({ ...prev, permissions: [] }))}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {isAr ? 'إلغاء الكل' : 'Clear All'}
                    </button>
                  </div>
                )}
              </div>

              {selectedRole.slug === 'admin' && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>
                    {isAr
                      ? 'دور مدير النظام يمتلك جميع الصلاحيات تلقائياً بشكل محمي لمنع فقدان الوصول الإداري.'
                      : 'System Admin retains all permissions automatically to prevent administrative lockout.'}
                  </span>
                </div>
              )}

              {/* Role Metadata Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    {isAr ? 'اسم الدور (عربي)' : 'Role Name (Arabic)'}
                  </label>
                  <input
                    required
                    type="text"
                    disabled={selectedRole.slug === 'admin'}
                    value={roleDraft.name_ar}
                    onChange={(e) =>
                      setRoleDraft((prev) => ({ ...prev, name_ar: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg disabled:opacity-60"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    {isAr ? 'اسم الدور (إنجليزي)' : 'Role Name (English)'}
                  </label>
                  <input
                    type="text"
                    disabled={selectedRole.slug === 'admin'}
                    value={roleDraft.name_en}
                    onChange={(e) =>
                      setRoleDraft((prev) => ({ ...prev, name_en: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg disabled:opacity-60"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    {isAr ? 'وصف الدور ومهامه' : 'Role Description'}
                  </label>
                  <input
                    type="text"
                    value={isAr ? roleDraft.description_ar : roleDraft.description_en}
                    onChange={(e) =>
                      setRoleDraft((prev) =>
                        isAr
                          ? { ...prev, description_ar: e.target.value }
                          : { ...prev, description_en: e.target.value }
                      )
                    }
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </div>
              </div>

              {/* Permission Groups Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {PERMISSION_GROUPS.map((group) => {
                  const groupKeys = group.permissions.map((p) => p.key);
                  const checkedInGroup = groupKeys.filter((k) =>
                    roleDraft.permissions.includes(k)
                  ).length;
                  const allInGroup = checkedInGroup === groupKeys.length;
                  return (
                    <div
                      key={group.id}
                      className="border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 bg-slate-50/60 dark:bg-slate-950/40 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-800">
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          {isAr ? group.title_ar : group.title_en}
                        </div>
                        <button
                          type="button"
                          disabled={selectedRole.slug === 'admin'}
                          onClick={() => toggleDraftGroup(groupKeys)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50 tabular-nums"
                        >
                          <CheckSquare className="w-3 h-3" />
                          <span>
                            {checkedInGroup}/{groupKeys.length}{' '}
                            {allInGroup
                              ? isAr
                                ? 'إلغاء'
                                : 'Uncheck'
                              : isAr
                              ? 'تحديد'
                              : 'All'}
                          </span>
                        </button>
                      </div>

                      <div className="space-y-2">
                        {group.permissions.map((perm) => {
                          const checked = roleDraft.permissions.includes(perm.key);
                          return (
                            <label
                              key={perm.key}
                              className={`flex items-start gap-2.5 p-2 rounded-lg border transition-colors ${
                                selectedRole.slug === 'admin'
                                  ? 'cursor-default opacity-80'
                                  : 'cursor-pointer hover:bg-white dark:hover:bg-slate-900'
                              } ${
                                checked
                                  ? 'bg-white dark:bg-slate-900 border-emerald-700/40 dark:border-emerald-500/40'
                                  : 'border-transparent'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={selectedRole.slug === 'admin'}
                                onChange={() => toggleDraftPermission(perm.key)}
                                className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                                  {isAr ? perm.label_ar : perm.label_en}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                                  {isAr ? perm.desc_ar : perm.desc_en}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  {selectedRole.is_system !== 1 && (
                    <button
                      type="button"
                      disabled={(selectedRole.users_count ?? 0) > 0}
                      onClick={() =>
                        setConfirmDelete({
                          kind: 'role',
                          id: selectedRole.id,
                          label: isAr ? selectedRole.name_ar : selectedRole.name_en,
                        })
                      }
                      title={
                        (selectedRole.users_count ?? 0) > 0
                          ? isAr
                            ? 'انقل المستخدمين من هذا الدور قبل حذفه'
                            : 'Reassign users before deleting'
                          : ''
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {isAr ? 'حذف الدور' : 'Delete Role'}
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={savingRole}
                  className="px-5 py-2.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {savingRole
                    ? isAr
                      ? 'جاري الحفظ...'
                      : 'Saving...'
                    : isAr
                    ? 'حفظ صلاحيات الدور'
                    : 'Save Role Permissions'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Add / Edit User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveUser}
            className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingUser
                  ? isAr
                    ? 'تعديل بيانات المستخدم وصلاحيته'
                    : 'Edit User & Role'
                  : isAr
                  ? 'إضافة مستخدم جديد'
                  : 'Create New User'}
              </h3>
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isAr ? 'الاسم الكامل' : 'Full Name'}
                </label>
                <input
                  required
                  type="text"
                  value={userForm.full_name}
                  onChange={(e) =>
                    setUserForm((prev) => ({ ...prev, full_name: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isAr ? 'البريد الإلكتروني' : 'Email'}
                </label>
                <input
                  required
                  type="email"
                  dir="ltr"
                  value={userForm.email}
                  onChange={(e) =>
                    setUserForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isAr ? 'رقم الجوال' : 'Phone'}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  placeholder="05xxxxxxxx"
                  value={userForm.phone}
                  onChange={(e) =>
                    setUserForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isAr ? 'الدور الوظيفي' : 'Assigned Role'}
                </label>
                <select
                  required
                  value={userForm.role_id}
                  onChange={(e) =>
                    setUserForm((prev) => ({ ...prev, role_id: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {isAr ? r.name_ar : r.name_en} (
                      {isAr
                        ? `${r.permissions.length} صلاحية`
                        : `${r.permissions.length} perms`}
                      )
                    </option>
                  ))}
                </select>
                {selectedFormRole && (
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {isAr ? 'ملخص الصلاحيات: ' : 'Permissions Summary: '}
                    </span>
                    {isAr
                      ? selectedFormRole.description_ar ||
                        `${selectedFormRole.permissions.length} من ${totalAvailablePerms} صلاحية مفعلة`
                      : selectedFormRole.description_en ||
                        `${selectedFormRole.permissions.length} of ${totalAvailablePerms} permissions enabled`}
                  </div>
                )}
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {editingUser
                    ? isAr
                      ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)'
                      : 'New Password (leave blank to keep current)'
                    : isAr
                    ? 'كلمة المرور'
                    : 'Password'}
                </label>
                <input
                  required={!editingUser}
                  type="password"
                  dir="ltr"
                  minLength={6}
                  placeholder="••••••"
                  value={userForm.password}
                  onChange={(e) =>
                    setUserForm((prev) => ({ ...prev, password: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={userForm.is_active}
                    disabled={editingUser?.id === currentUser.id}
                    onChange={(e) =>
                      setUserForm((prev) => ({ ...prev, is_active: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                  />
                  <span>
                    {isAr ? 'الحساب نشط ويحق له تسجيل الدخول' : 'Account is active and allowed to sign in'}
                  </span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={savingUser}
                className="px-5 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg disabled:opacity-50"
              >
                {savingUser
                  ? isAr
                    ? 'جاري الحفظ...'
                    : 'Saving...'
                  : editingUser
                  ? isAr
                    ? 'حفظ التعديلات'
                    : 'Save Changes'
                  : isAr
                  ? 'إنشاء المستخدم'
                  : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Role Modal */}
      {showNewRoleModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateNewRole}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAr ? 'إنشاء دور وظيفي جديد بصلاحيات مخصصة' : 'Create Custom Role'}
              </h3>
              <button
                type="button"
                onClick={() => setShowNewRoleModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isAr ? 'اسم الدور (عربي)' : 'Role Name (Arabic)'}
                </label>
                <input
                  required
                  type="text"
                  placeholder={isAr ? 'مثال: أمين مستودع' : 'e.g. Warehouse Keeper'}
                  value={newRoleForm.name_ar}
                  onChange={(e) =>
                    setNewRoleForm((prev) => ({ ...prev, name_ar: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isAr ? 'اسم الدور (إنجليزي)' : 'Role Name (English)'}
                </label>
                <input
                  type="text"
                  placeholder="Warehouse Keeper"
                  value={newRoleForm.name_en}
                  onChange={(e) =>
                    setNewRoleForm((prev) => ({ ...prev, name_en: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isAr ? 'وصف الدور' : 'Description'}
                </label>
                <input
                  type="text"
                  placeholder={
                    isAr
                      ? 'مثال: مسؤول استلام البضائع والجرد بدون صلاحية الحذف'
                      : 'Role responsibilities summary'
                  }
                  value={newRoleForm.description_ar}
                  onChange={(e) =>
                    setNewRoleForm((prev) => ({
                      ...prev,
                      description_ar: e.target.value,
                      description_en: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 dark:text-white">
                  {isAr ? 'الصلاحيات الممنوحة' : 'Permissions'} ({newRoleForm.permissions.length}/
                  {totalAvailablePerms})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setNewRoleForm((prev) => ({
                        ...prev,
                        permissions: [...ALL_PERMISSION_KEYS],
                      }))
                    }
                    className="text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    {isAr ? 'تحديد الكل' : 'Select All'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRoleForm((prev) => ({ ...prev, permissions: [] }))}
                    className="text-slate-500 hover:underline"
                  >
                    {isAr ? 'إلغاء الكل' : 'Clear'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PERMISSION_GROUPS.map((group) => (
                  <div
                    key={group.id}
                    className="border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/40 space-y-1.5"
                  >
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 pb-1 border-b border-slate-200/70 dark:border-slate-800">
                      {isAr ? group.title_ar : group.title_en}
                    </div>
                    {group.permissions.map((perm) => {
                      const checked = newRoleForm.permissions.includes(perm.key);
                      return (
                        <label
                          key={perm.key}
                          className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setNewRoleForm((prev) => ({
                                ...prev,
                                permissions: checked
                                  ? prev.permissions.filter((p) => p !== perm.key)
                                  : [...prev.permissions, perm.key],
                              }))
                            }
                            className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                          />
                          <span className="text-slate-700 dark:text-slate-300">
                            {isAr ? perm.label_ar : perm.label_en}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowNewRoleModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={creatingRole}
                className="px-5 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg disabled:opacity-50"
              >
                {creatingRole
                  ? isAr
                    ? 'جاري الإنشاء...'
                    : 'Creating...'
                  : isAr
                  ? 'حفظ وإنشاء الدور'
                  : 'Create Role'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {confirmDelete.kind === 'user'
                ? isAr
                  ? 'تأكيد حذف المستخدم'
                  : 'Confirm User Deletion'
                : isAr
                ? 'تأكيد حذف الدور'
                : 'Confirm Role Deletion'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {isAr
                ? `هل أنت متأكد من حذف "${confirmDelete.label}"؟ لا يمكن التراجع عن هذا الإجراء.`
                : `Are you sure you want to delete "${confirmDelete.label}"? This action cannot be undone.`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
              >
                {deleting ? (isAr ? 'جاري الحذف...' : 'Deleting...') : isAr ? 'حذف' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
