const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(authorize('admin'));

router.route('/doctors')
    .get(adminController.getAllDoctors)
    .post(adminController.createDoctor);

router.route('/doctors/:id/approve')
    .put(adminController.approveDoctor);

router.route('/leaves')
    .post(adminController.addLeave);

module.exports = router;
