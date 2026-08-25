import { useEffect } from 'react';
import Layout from './components/Layout';
import MainPage from './pages/MainPage';
import SettingsDialog from './components/SettingsDialog';
import { useAppStore } from './store/appStore';

/**
 * 应用根组件：加载连接列表与历史，渲染顶栏布局 + 工作台 + AI 配置弹窗。
 * 采用单页工作台形态，AI 配置以弹窗呈现（满足 P1-3）。
 */
export default function App(): JSX.Element {
  const loadConnections = useAppStore((s) => s.loadConnections);
  const loadHistory = useAppStore((s) => s.loadHistory);

  useEffect(() => {
    void loadConnections();
    void loadHistory();
  }, [loadConnections, loadHistory]);

  return (
    <Layout>
      <MainPage />
      <SettingsDialog />
    </Layout>
  );
}
