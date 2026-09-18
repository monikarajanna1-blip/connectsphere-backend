import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Splash from './Screens/Splash';
import Login from './Screens/Login';
import Register from './Screens/Register';
import Home from './Screens/Home';
import ForgotPassword from './Screens/ForgotPassword';
import ResetPassword from './Screens/ResetPassword';
import MeetingRoom from './Screens/MeetingRoom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Splash />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/home" element={<Home />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/meeting/:roomId" element={<MeetingRoom />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;