const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Middlewares
const { errorHandler } = require('./src/middlewares/errorMiddleware');

// Routes
const authRoutes = require('./src/routes/authRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const doctorRoutes = require('./src/routes/doctorRoutes');
const patientRoutes = require('./src/routes/patientRoutes');

// Cron Jobs
const { initCronJobs } = require('./src/jobs/cronJobs');

const app = express();

app.use(cors());
app.use(express.json());

// Setup Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/patient', patientRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Healthcare Appointment Manager API is running' });
});

// 404 Handler
app.use((req, res, next) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const seedAdmin = require('./src/config/seedAdmin');

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    // Seed default admin
    await seedAdmin();
    // Initialize background cron jobs
    initCronJobs();
});