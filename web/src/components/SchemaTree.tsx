import { useState } from 'react';
import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  IconButton,
  Chip,
  Typography,
  Collapse,
  CircularProgress,
  Divider,
  Tooltip,
} from '@mui/material';
import TableChartIcon from '@mui/icons-material/TableChart';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useAppStore } from '../store/appStore';
import type { ConnectionPublic, TableInfo } from '../types';

/**
 * 左侧表结构树（本次迭代新增）：在选中连接后展示该库的表清单。
 * - 点击表名 / 右侧「执行」图标：将 `SELECT * FROM <name> LIMIT 1000;` 填入编辑器并自动执行；
 * - 点击左侧箭头：展开 / 收起该表的列结构（列名 / 类型 / 可空 / 注释）；
 * - 加载中显示进度环，失败显示错误文案，空库显示占位提示。
 */
export default function SchemaTree({ connection }: { connection: ConnectionPublic }): JSX.Element {
  const tables = useAppStore((s) => s.tables);
  const loading = useAppStore((s) => s.tablesLoading);
  const error = useAppStore((s) => s.tablesError);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (name: string) =>
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  const runTable = (name: string) => {
    const sql = `SELECT * FROM ${name} LIMIT 1000;`;
    useAppStore.getState().setSql(sql);
    void useAppStore.getState().runQuery({});
  };

  return (
    <Box className="flex flex-col h-full">
      <Divider />
      <Box className="flex items-center justify-between px-3 py-2">
        <Typography variant="subtitle2" className="font-semibold text-gray-700">
          表清单
        </Typography>
        <Typography variant="caption" className="text-gray-400">
          {connection.database}
        </Typography>
      </Box>

      <Box className="flex-1 overflow-auto px-1 pb-2">
        {loading ? (
          <Box className="flex items-center gap-2 px-3 py-3 text-gray-400 text-sm">
            <CircularProgress size={16} />
            <span>加载表结构…</span>
          </Box>
        ) : error ? (
          <Typography className="px-3 py-3 text-red-500 text-sm">加载失败：{error}</Typography>
        ) : tables.length === 0 ? (
          <Typography className="px-3 py-3 text-gray-400 text-sm">
            该数据库暂无可读取的表。
          </Typography>
        ) : (
          <List dense disablePadding>
            {tables.map((table: TableInfo) => {
              const open = Boolean(expanded[table.name]);
              return (
                <Box key={table.name}>
                  <ListItemButton
                    className="flex-col items-stretch group"
                    onClick={() => runTable(table.name)}
                  >
                    <Box className="flex items-center w-full">
                      <IconButton
                        size="small"
                        className="mr-0.5 text-gray-400"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(table.name);
                        }}
                        aria-label={open ? '收起' : '展开'}
                      >
                        {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </IconButton>
                      <ListItemIcon className="min-w-0 mr-1">
                        <TableChartIcon fontSize="small" className="text-gray-500" />
                      </ListItemIcon>
                      <ListItemText
                        primary={table.name}
                        secondary={table.comment || `${table.columns.length} 列`}
                        primaryTypographyProps={{ className: 'font-mono truncate', noWrap: true }}
                        secondaryTypographyProps={{ className: 'truncate', noWrap: true }}
                      />
                      <Tooltip title="查询该表（SELECT * LIMIT 1000）">
                        <IconButton
                          size="small"
                          className="ml-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            runTable(table.name);
                          }}
                        >
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </ListItemButton>

                  <Collapse in={open} timeout="auto" unmountOnExit>
                    <List dense disablePadding className="bg-gray-50">
                      {table.columns.map((col) => (
                        <ListItemButton
                          key={col.name}
                          className="pl-10 pr-2 py-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            runTable(table.name);
                          }}
                        >
                          <Box className="flex items-center gap-2 w-full text-xs overflow-hidden">
                            <Typography className="font-mono font-semibold text-gray-800 truncate">
                              {col.name}
                            </Typography>
                            <Chip
                              label={col.dataType}
                              size="small"
                              variant="outlined"
                              className="h-4 text-[10px] leading-4 shrink-0"
                            />
                            <Typography
                              className={`shrink-0 ${col.nullable ? 'text-amber-600' : 'text-gray-400'}`}
                            >
                              {col.nullable ? '可空' : '非空'}
                            </Typography>
                            {col.comment && (
                              <Typography className="text-gray-400 truncate flex-1">
                                {col.comment}
                              </Typography>
                            )}
                          </Box>
                        </ListItemButton>
                      ))}
                    </List>
                  </Collapse>
                </Box>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
}
