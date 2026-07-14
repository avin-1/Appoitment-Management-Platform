const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patientController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(authorize('patient'));

router.get('/doctors', patientController.searchDoctors);
router.get('/doctors/:doctorId/slots', patientController.getDoctorSlots);
router.post('/appointments/book', patientController.bookAppointment);
router.post('/appointments/:appointmentId/symptoms', patientController.submitSymptoms);
router.get('/appointments', patientController.getAppointments);

module.exports = router;
