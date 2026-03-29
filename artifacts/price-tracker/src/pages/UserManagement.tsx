import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { User, Plus, Trash2, Shield, Lock, Unlock } from 'lucide-react';

interface User {
  id: number;
  username: string;
  isActive: boolean;
  createdAt: string;
}

const UserManagement = () => {
  const { user, isGuest, token, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState('');

  // 检查权限
  useEffect(() => {
    if (isGuest || !user || !user.isAdmin) {
      setLocation('/');
    }
  }, [isGuest, user, setLocation]);

  // 获取用户列表
  const fetchUsers = async () => {
    if (!token) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/users', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      } else {
        const errorData = await response.json();
        setError(errorData.error || '获取用户列表失败');
      }
    } catch (error) {
      setError('网络错误，请检查连接');
    } finally {
      setLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    if (!isGuest && user?.isAdmin) {
      fetchUsers();
    }
  }, [isGuest, user]);

  // 添加用户
  const handleAddUser = async () => {
    if (!token || !newUsername || !newPassword) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      
      if (response.ok) {
        setShowAddDialog(false);
        setNewUsername('');
        setNewPassword('');
        await fetchUsers();
      } else {
        const errorData = await response.json();
        setError(errorData.error || '创建用户失败');
      }
    } catch (error) {
      setError('网络错误，请检查连接');
    } finally {
      setLoading(false);
    }
  };

  // 切换用户状态
  const toggleUserStatus = async (user: User) => {
    if (!token) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/users/${user.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      
      if (response.ok) {
        await fetchUsers();
      } else {
        const errorData = await response.json();
        setError(errorData.error || '更新用户状态失败');
      }
    } catch (error) {
      setError('网络错误，请检查连接');
    } finally {
      setLoading(false);
    }
  };

  // 确认删除
  const confirmDelete = async () => {
    if (!userToDelete || deleteConfirmUsername !== userToDelete.username || !token) return;
    
    // 这里实际上是禁用用户（软删除）
    await toggleUserStatus(userToDelete);
    setShowDeleteDialog(false);
    setUserToDelete(null);
    setDeleteConfirmUsername('');
  };

  if (isGuest || !user || !user.isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="gradient-bg absolute inset-0 opacity-100" />
      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-4 sm:space-y-6 relative z-10">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-500" />
            用户管理
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => setLocation('/')}
              variant="outline"
              size="sm"
            >
              返回首页
            </Button>
            <Button
              onClick={logout}
              variant="outline"
              size="sm"
            >
              <User className="w-4 h-4 mr-1" />
              退出
            </Button>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 操作区 */}
        <div className="flex items-center justify-between mt-6">
          <h2 className="text-lg font-semibold">用户列表</h2>
          <Button
            onClick={() => setShowAddDialog(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            添加用户
          </Button>
        </div>

        {/* 用户表格 */}
        <div className="mt-4 border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">用户名</TableHead>
                <TableHead className="w-1/3">状态</TableHead>
                <TableHead className="w-1/4">创建时间</TableHead>
                <TableHead className="w-1/6 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    加载中...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    暂无用户
                  </TableCell>
                </TableRow>
              ) : (
                users.map((userItem) => (
                  <TableRow key={userItem.id}>
                    <TableCell className="font-medium">{userItem.username}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {userItem.isActive ? (
                          <Unlock className="w-4 h-4 text-green-500" />
                        ) : (
                          <Lock className="w-4 h-4 text-red-500" />
                        )}
                        <span className={userItem.isActive ? 'text-green-600' : 'text-red-600'}>
                          {userItem.isActive ? '启用' : '禁用'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(userItem.createdAt).toLocaleString('zh-CN')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleUserStatus(userItem)}
                          disabled={loading}
                        >
                          {userItem.isActive ? '禁用' : '启用'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setUserToDelete(userItem);
                            setShowDeleteDialog(true);
                            setDeleteConfirmUsername('');
                          }}
                          disabled={loading}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* 添加用户对话框 */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>添加新用户</DialogTitle>
              <DialogDescription>
                输入用户名和密码创建新用户
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="输入用户名"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="输入密码"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                取消
              </Button>
              <Button
                onClick={handleAddUser}
                disabled={loading || !newUsername || !newPassword}
              >
                {loading ? '创建中...' : '创建'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 删除用户对话框 */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>确认删除</DialogTitle>
              <DialogDescription>
                确定要删除用户 <strong>{userToDelete?.username}</strong> 吗？
                此操作将禁用该用户，使其无法登录。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="confirm-username">
                  请输入用户名 <strong>{userToDelete?.username}</strong> 确认删除
                </Label>
                <Input
                  id="confirm-username"
                  value={deleteConfirmUsername}
                  onChange={(e) => setDeleteConfirmUsername(e.target.value)}
                  placeholder={`输入 ${userToDelete?.username} 确认`}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={loading || deleteConfirmUsername !== userToDelete?.username}
              >
                {loading ? '处理中...' : '确认删除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default UserManagement;