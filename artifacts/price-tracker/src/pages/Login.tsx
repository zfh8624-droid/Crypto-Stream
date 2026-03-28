import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-start justify-center bg-black p-4 pt-12">
      <div className="w-full max-w-md">
        <div className="bg-gray-900 border-4 border-blue-500 rounded-2xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">盯盘系统</h1>
            <p className="text-white">请登录您的账户</p>
          </div>

          {error && (
            <div className="bg-red-900 border-2 border-red-500 text-white px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-base font-bold text-white mb-2">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-4 bg-gray-800 border-2 border-blue-500 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 text-base"
                placeholder="请输入用户名"
                required
              />
            </div>

            <div>
              <label className="block text-base font-bold text-white mb-2">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-4 bg-gray-800 border-2 border-blue-500 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 text-base"
                placeholder="请输入密码"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                localStorage.removeItem('hasChosenMode');
                window.location.href = '/';
              }}
              className="text-white hover:text-gray-300 text-base font-bold transition-colors"
            >
              ← 返回欢迎页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
