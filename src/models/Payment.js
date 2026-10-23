const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  memberId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('CHARGE', 'REFUND'),
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: { min: 0.01 },
  },
  status: {
    type: DataTypes.ENUM('SUCCESS', 'FAILED', 'PENDING'),
    allowNull: false,
    defaultValue: 'SUCCESS',
  },
  reason: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  relatedPaymentId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'payments',
  timestamps: true,
});

module.exports = Payment;
