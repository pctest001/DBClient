import { AppBar, Toolbar, Typography, Box, IconButton, Tooltip } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import { useAppStore } from '../store/appStore';
import type { ReactNode } from 'react';

/**
 * 全局布局：顶栏（应用名 + 当前连接 + 设置入口）+ 内容区。
 */
export default function Layout({ children }: { children: ReactNode }): JSX.Element {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const current = useAppStore((s) => s.currentConnection);

  return (
    <Box className="flex flex-col h-full bg-gray-100">
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar variant="dense">
          <Typography variant="h6" className="font-semibold text-blue-700 select-none">
            DBClient
          </Typography>
          <Box className="flex-1" />
          {current && (
            <Typography variant="body2" className="mr-3 text-gray-600">
              当前连接：{current.name}（{current.type === 'mysql' ? 'MySQL' : 'PostgreSQL'}）
            </Typography>
          )}
          <Tooltip title="AI / 接口配置">
            <IconButton size="small" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Box className="flex-1 min-h-0 overflow-hidden">{children}</Box>
    </Box>
  );
}
