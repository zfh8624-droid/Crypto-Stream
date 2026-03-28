import React from 'react';
import { useAuth } from '@/contexts/AuthContext';

const Welcome: React.FC = () => {
  const { switchToGuest } = useAuth();

  const handleGuestMode = () => {
    switchToGuest();
    localStorage.setItem('hasChosenMode', 'true');
    window.location.href = '/';
  };

  const handleLoginMode = () => {
    localStorage.setItem('hasChosenMode', 'true');
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen flex items-start justify-center bg-black p-4">
      <div className="w-full max-w-md -mt-8">
        <div className="text-center mb-8 pt-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">🚀 盯盘系统</h1>
          <p className="text-white text-base">实时价格追踪与信号监控</p>
        </div>

        <div>
          {/* 访客模式 */}
          <div 
            className="bg-gray-900 border-4 border-yellow-500 rounded-2xl p-6 cursor-pointer active:scale-[0.98] mb-8"
            onClick={handleGuestMode}
          >
            <div className="text-center">
              <div className="text-5xl mb-3">👤</div>
              <h2 className="text-xl font-bold text-white mb-2">访客模式</h2>
              <div className="text-white space-y-1.5 mb-4">
                <p className="text-base">• 无需登录</p>
                <p className="text-base">• 监控需要保持页面打开</p>
                <p className="text-base">• 配置保存在本地</p>
              </div>
              <button 
                className="w-full px-6 py-4 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-lg text-lg"
              >
                开始使用
              </button>
            </div>
          </div>

          {/* 登录模式 */}
          <div 
            className="bg-gray-900 border-4 border-blue-500 rounded-2xl p-6 cursor-pointer active:scale-[0.98]"
            onClick={handleLoginMode}
          >
            <div className="text-center">
              <div className="text-5xl mb-3">🔐</div>
              <h2 className="text-xl font-bold text-white mb-2">登录模式</h2>
              <div className="text-white space-y-1.5 mb-4">
                <p className="text-base">• 账户登录</p>
                <p className="text-base">• 后端持续监控</p>
                <p className="text-base">• 数据云端保存</p>
              </div>
              <button 
                className="w-full px-6 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-lg"
              >
                登录
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
