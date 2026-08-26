import { useState } from 'react';
import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  IconButton,
  Chip,
  Button,
  TextField,
  Typography,
  Divider,
  CircularProgress,
  Tooltip,
  Snackbar,
  Alert,
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import AddIcon from '@mui/icons-material/Add';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useAppStore } from '../store/appStore';
import { api } from '../api/client';
import type { ConnectionPublic } from '../types';
import ConnectionForm from './ConnectionForm';
import SchemaTree from './SchemaTree';

/**
 * 左侧连接管理面板（P0-1）：列表 + 新建/编辑/删除/测试/打开。
 */
export default function ConnectionManager(): JSX.Element {
  const connections = useAppStore((s) => s.connections);
  const current = useAppStore((s) => s.currentConnection);
  const setCurrent = useAppStore((s) => s.setCurrentConnection);
  const loadConnections = useAppStore((s) => s.loadConnections);
  const loadHistory = useAppStore((s) => s.loadHistory);

  const [filter, setFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionPublic | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [snack, setSnack] = useState<{ ok: boolean; msg: string } | null>(null);

  const filtered = connections.filter((c) =>
    c.name.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (c: ConnectionPublic) => {
    setEditing(c);
    setFormOpen(true);
  };

  const handleOpen = (c: ConnectionPublic) => {
    setCurrent(c);
    // store.setCurrentConnection 已会自动 loadTables；此处显式再触发一次，
    // 确保「打开连接」与「store 自动加载」行为一致。
    void useAppStore.getState().loadTables(c.id);
    void loadHistory();
  };

  const handleTest = async (c: ConnectionPublic) => {
    setBusyId(c.id);
    try {
      const res = await api.testSavedConnection(c.id);
      setSnack({ ok: res.ok, msg: res.ok ? `连接成功（${res.latencyMs}ms）` : res.message });
    } catch (err) {
      setSnack({ ok: false, msg: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (c: ConnectionPublic) => {
    if (!window.confirm(`确认删除连接「${c.name}」？`)) return;
    try {
      await api.deleteConnection(c.id);
      if (current?.id === c.id) setCurrent(null);
      await loadConnections();
      setSnack({ ok: true, msg: '已删除' });
    } catch (err) {
      setSnack({ ok: false, msg: (err as Error).message });
    }
  };

  return (
    <Box className="flex flex-col h-full">
      <Box className="p-3 border-b border-gray-200">
        <Box className="flex items-center justify-between mb-2">
          <Typography variant="subtitle2" className="font-semibold text-gray-700">
            数据库连接
          </Typography>
          <Button size="small" startIcon={<AddIcon />} onClick={openNew} variant="outlined">
            新建
          </Button>
        </Box>
        <TextField
          size="small"
          placeholder="筛选连接名"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          fullWidth
        />
      </Box>

      <Box className="flex-1 min-h-0 flex flex-col">
        <Box className="overflow-auto max-h-[45%]">
          {filtered.length === 0 ? (
            <Typography className="p-4 text-gray-400 text-sm">暂无连接，点击「新建」添加。</Typography>
          ) : (
            <List dense>
              {filtered.map((c) => {
                const active = current?.id === c.id;
                return (
                  <ListItemButton
                    key={c.id}
                    selected={active}
                    onClick={() => handleOpen(c)}
                    className="flex-col items-stretch"
                  >
                    <Box className="flex items-center w-full">
                      <ListItemIcon className="min-w-0 mr-1">
                        <StorageIcon fontSize="small" color={active ? 'primary' : 'disabled'} />
                      </ListItemIcon>
                      <ListItemText
                        primary={c.name}
                        secondary={`${c.host}:${c.port} / ${c.database}`}
                        primaryTypographyProps={{ className: 'truncate', noWrap: true }}
                        secondaryTypographyProps={{ className: 'truncate', noWrap: true }}
                      />
                      {active && <CheckCircleIcon fontSize="small" className="text-green-500 ml-1" />}
                    </Box>
                    <Box className="flex items-center mt-1 gap-1">
                      <Chip
                        label={c.type === 'mysql' ? 'MySQL' : 'PostgreSQL'}
                        size="small"
                        variant="outlined"
                        className="mr-1"
                      />
                      <Box className="flex-1" />
                      <Tooltip title="测试连接">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleTest(c);
                          }}
                        >
                          {busyId === c.id ? <CircularProgress size={16} /> : <PlayCircleIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="编辑">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(c);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(c);
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Box>

        {current && <SchemaTree connection={current} />}
      </Box>

      <ConnectionForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={async () => {
          setFormOpen(false);
          await loadConnections();
        }}
      />

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert severity={snack.ok ? 'success' : 'error'} onClose={() => setSnack(null)}>
            {snack.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
