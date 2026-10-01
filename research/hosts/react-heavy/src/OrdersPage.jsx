import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { format } from 'date-fns';
import { useStore } from './store.js';

const COLOR = { new: 'default', paid: 'primary', shipped: 'warning', done: 'success' };

export default function OrdersPage() {
  const { orders, totals } = useStore();
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Orders ({totals.count}) — ${totals.sum.toFixed(2)}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>Customer</TableCell>
            <TableCell>Placed</TableCell>
            <TableCell align="right">Total</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id} hover>
              <TableCell>{o.id}</TableCell>
              <TableCell>{o.customer}</TableCell>
              <TableCell>{format(o.placedAt, 'yyyy-MM-dd HH:mm')}</TableCell>
              <TableCell align="right">${o.total.toFixed(2)}</TableCell>
              <TableCell>
                <Chip size="small" label={o.status} color={COLOR[o.status]} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
