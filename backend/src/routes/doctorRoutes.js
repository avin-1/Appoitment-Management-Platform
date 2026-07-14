const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctorController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(authorize('doctor'));

router.put('/profile', doctorController.updateProfile);
router.post('/slots', doctorController.generateSlots);
router.get('/appointments', doctorController.getAppointments);
router.post('/appointments/:appointmentId/notes', doctorController.submitPostVisitNotes);

module.exports = router;
