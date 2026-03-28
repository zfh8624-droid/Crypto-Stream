import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

interface User {
  id: string;
  username: string;
  isAdmin: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isGuest: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  switchToGuest: () => void;
  switchToLogin: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 验证token是否有效
const verifyToken = async (token: string): Promise<{ valid: boolean; user?: User }> => {
  try {
    const response = await fetch('/api/verify', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return { valid: true, user: data.user };
    }
    return { valid: false };
  } catch (error) {
    console.error('Token verification failed:', error);
    return { valid: false };
  }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(true);
  const [loading, setLoading] = useState(true);

  // 清除登录状态的函数（独立于logout，避免循环依赖）
  const clearAuthState = useCallback(() => {
    setUser(null);
    setToken(null);
    setIsGuest(true);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.setItem('mode', 'guest');
    localStorage.removeItem('hasChosenMode');
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const savedToken = localStorage.getItem('token');
      const savedUser = localStorage.getItem('user');
      const savedMode = localStorage.getItem('mode');

      if (savedMode === 'login' && savedToken && savedUser) {
        // 验证token是否仍然有效
        const verification = await verifyToken(savedToken);
        
        if (verification.valid && verification.user) {
          // token有效，使用从服务器返回的最新用户信息
          setToken(savedToken);
          setUser(verification.user);
          setIsGuest(false);
          // 更新localStorage中的用户信息
          localStorage.setItem('user', JSON.stringify(verification.user));
        } else {
          // token无效，清除登录状态
          clearAuthState();
        }
      } else {
        setIsGuest(true);
      }
      setLoading(false);
    };

    initAuth();
  }, [clearAuthState]);

  const login = async (username: string, password: string) => {
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '登录失败');
      }

      const data = await response.json();
      setToken(data.token);
      setUser(data.user);
      setIsGuest(false);

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('mode', 'login');
      localStorage.setItem('hasChosenMode', 'true');
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    clearAuthState();
  };

  const switchToGuest = () => {
    setIsGuest(true);
    localStorage.setItem('mode', 'guest');
    localStorage.setItem('hasChosenMode', 'true');
  };

  const switchToLogin = () => {
    setIsGuest(false);
    localStorage.setItem('mode', 'login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isGuest,
        login,
        logout,
        switchToGuest,
        switchToLogin,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
