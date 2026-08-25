import { useEffect } from 'react';
import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  IconButton,
  Typography,
  Chip,
  Button,
  Tooltip,
  Divider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import { useAppStore } from '../store/appStore';

/**
 * 执行历史面板（P1-1）：列出历史，点击载入 SQL 到编辑器，支持删除单条 / 清空。
 */
export default function HistoryPanel(): JSX.Element {
  const history = useAppStore((s) => s.history);
  const loadHistory = useAppStore((s) => s.loadHistory);
  const deleteHistoryItem = useAppStore((s) => s.deleteHistoryItem);
  const clearHistory = useAppStore((s) => s.clearHistory);
  const setSql = useAppStore((s) => s.setSql);
  const current = useAppStore((s) => s.currentConnection);

  // 当前连接变化时刷新历史
  useEffect(() => {
    void loadHistory();
  }, [current, loadHistory]);

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', { hour12: false });
    } catch {
      return iso;
    }
  };

  return (
    <Box className="flex flex-col h-full">
      <Box className="flex items-center px-3 py-2 border-b border-gray-200">
        <Typography variant="subtitle2" className="font-semibold text-gray-700">
          执行历史
        </Typography>
        <Box className="flex-1" />
        <Button
          size="small"
          startIcon={<ClearAllIcon />}
          disabled={history.length === 0}
          onClick={() => {
            if (window.confirm('确认清空全部历史？')) void clearHistory();
          }}
        >
          清空
        </Button>
      </Box>
      <Box className="flex-1 overflow-auto">
        {history.length === 0 ? (
          <Typography className="p-3 text-gray-400 text-sm">暂无执行历史。</Typography>
        ) : (
          <List dense>
            {history.map((h) => (
              <ListItemButton
                key={h.id}
                onClick={() => setSql(h.sql)}
                className="flex-col items-stretch"
              >
                <Box className="flex items-center w-full gap-1">
                  <Chip
                    size="small"
                    label={h.status === 'success' ? '成功' : '失败'}
                    color={h.status === 'success' ? 'success' : 'error'}
                    className="mr-1"
                  />
                  <Typography variant="caption" className="text-gray-500 truncate">
                    {h.connectionName} · {fmtTime(h.executedAt)}
                  </Typography>
                  <Box className="flex-1" />
                  <Tooltip title="删除">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteHistoryItem(h.id);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography
                  component="pre"
                  className="text-xs text-gray-700 whitespace-pre-wrap break-words mt-1 max-h-16 overflow-hidden"
                >
                  {h.sql}
                </Typography>
                {h.status === 'error' && h.error && (
                  <Typography className="text-xs text-red-500 truncate">
                    错误：{h.error}
                  </Typography>
                )}
                <Divider className="mt-1" />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
}
