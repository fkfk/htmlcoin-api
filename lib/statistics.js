'use strict';

var async = require('async');
var bitcore = require('bitcore-lib');
var _ = bitcore.deps._;
var BN = bitcore.crypto.BN;
var LRU = require('lru-cache');
var Common = require('./common');

function StatisticsController(options) {

	this.node = options.node;

	this.node.services.bitcoind.on('tip', this._rapidProtectedUpdateTip.bind(this));

    /**
     * Statistic/Total
     */

    /**
     * 24h Cache
     */
    this.subsidyByBlockHeight = LRU(999999);
    this.blocksByHeight = LRU(999999);
    this.feeByHeight = LRU(999999);
    this.outputsByHeight = LRU(999999);

    /**
     * Statistic Cache By Days
     */
    this.statisticByDays = LRU(999999999);
    this.knownBlocks = LRU(999999999);

    this.lastRequestedBlock = 0;
    this.lastCheckedBlock = 0;
    this.totalSubsidityAmount = 0;

    /**
     *
     * @type {Common}
     */
	this.common = new Common({log: this.node.log});

	this.lastTipHeight = 0;
	this.lastTipInProcess = false;
	this.lastTipTimeout = false;

}

StatisticsController.DEFAULT_STATISTICS_COUNT_DAYS = 365; //1 year
StatisticsController.DEFAULT_STATISTICS_MAX_COUNT_DAYS = 365 * 2; //2 year

StatisticsController.prototype.getTimeSpan = function(req) {

    var days = req.query.days,
        defaultCountDays = StatisticsController.DEFAULT_STATISTICS_COUNT_DAYS,
        maxDays = StatisticsController.DEFAULT_STATISTICS_MAX_COUNT_DAYS;

    if (days === 'all') {
        return maxDays;
    }

    if (days && !isNaN(parseInt(days)) && days > 0) {

        if (maxDays < parseInt(days)) {
            return maxDays;
        }

        return parseInt(days);
    }

    return defaultCountDays;
};

StatisticsController.prototype.difficulty = function(req, res) {

    var self = this,
        currentDate = new Date(),
        formattedDate = this.formatTimestamp(currentDate),
        results = [],
        days = self.getTimeSpan(req),
        iterator = 0;

    while(self.statisticByDays.get(formattedDate) && days > iterator) {

        var cachedDay = self.statisticByDays.get(formattedDate),
            sum = cachedDay.difficulty && cachedDay.difficulty.sum && cachedDay.difficulty.count ? cachedDay.difficulty.sum / cachedDay.difficulty.count : 0;

        results.push({
            date: formattedDate,
            sum: sum
        });

        currentDate.setDate(currentDate.getDate() - 1);
        formattedDate = this.formatTimestamp(currentDate);
        iterator++;

    }

    return res.jsonp(results);
};

StatisticsController.prototype.stake = function(req, res) {

    var self = this,
        currentDate = new Date(),
        formattedDate = this.formatTimestamp(currentDate),
        results = [],
        days = self.getTimeSpan(req),
        iterator = 0;

    while(self.statisticByDays.get(formattedDate) && days > iterator) {

        var cachedDay = self.statisticByDays.get(formattedDate),
            sum = cachedDay.stake && cachedDay.stake.sum && self.totalSubsidityAmount ? cachedDay.stake.sum / self.totalSubsidityAmount : 0;

        results.push({
            date: formattedDate,
            sum: sum
        });

        currentDate.setDate(currentDate.getDate() - 1);
        formattedDate = this.formatTimestamp(currentDate);
        iterator++;

    }

    return res.jsonp(results);
};

StatisticsController.prototype.outputs = function(req, res) {

    var self = this,
        currentDate = new Date(),
        formattedDate = this.formatTimestamp(currentDate),
        results = [],
        days = self.getTimeSpan(req),
        iterator = 0;

    while(self.statisticByDays.get(formattedDate) && days > iterator) {

        var cachedDay = self.statisticByDays.get(formattedDate),
            sum = cachedDay.totalOutputVolume && cachedDay.totalOutputVolume.sum ? cachedDay.totalOutputVolume.sum : 0;

        results.push({
            date: formattedDate,
            sum: sum
        });

        currentDate.setDate(currentDate.getDate() - 1);
        formattedDate = this.formatTimestamp(currentDate);
        iterator++;

    }

    return res.jsonp(results);
};


StatisticsController.prototype.transactions = function(req, res) {

    var self = this,
        currentDate = new Date(),
        formattedDate = this.formatTimestamp(currentDate),
        results = [],
        days = self.getTimeSpan(req),
        iterator = 0;

    while(self.statisticByDays.get(formattedDate) && days > iterator) {

        var cachedDay = self.statisticByDays.get(formattedDate);

        results.push({
            date: formattedDate,
            transaction_count: cachedDay.numberOfTransactions.count,
            block_count: cachedDay.totalBlocks.count
        });

        currentDate.setDate(currentDate.getDate() - 1);
        formattedDate = this.formatTimestamp(currentDate);
        iterator++;

    }

    return res.jsonp(results);
};

StatisticsController.prototype.fees = function(req, res) {

	var self = this,
		currentDate = new Date(),
    	formattedDate = this.formatTimestamp(currentDate),
		results = [],
        days = self.getTimeSpan(req),
        iterator = 0;

	while(self.statisticByDays.get(formattedDate) && days > iterator) {

    	var cachedDay = self.statisticByDays.get(formattedDate),
			avg = cachedDay.totalTransactionFees.sum && cachedDay.totalTransactionFees.count ? cachedDay.totalTransactionFees.sum / cachedDay.totalTransactionFees.count : 0;

        results.push({
        	date: formattedDate,
            fee: avg
		});

        currentDate.setDate(currentDate.getDate() - 1);
    	formattedDate = this.formatTimestamp(currentDate);
        iterator++;

	}

    return res.jsonp(results);

};


StatisticsController.prototype.total = function(req, res) {

    var self = this,
        height = self.lastCheckedBlock,
        next = true,
        sumBetweenTime = 0,
        countBetweenTime = 0,
        numTransactions = 0,
        minedBlocks = 0,
        minedCurrencyAmount = 0,
        allFee = 0,
        sumDifficulty = 0,
        totalOutputsAmount = 0;

    while(next && height > 0) {

        var currentElement = self.blocksByHeight.get(height),
            subsidy = self.subsidyByBlockHeight.get(height),
            outputAmount = self.outputsByHeight.get(height);

        if (currentElement) {

            var nextElement = self.blocksByHeight.get(height + 1),
                fee = self.feeByHeight.get(height);

            if (nextElement) {
                sumBetweenTime += (nextElement.header.time - currentElement.header.time);
                countBetweenTime++;
            }

            numTransactions += currentElement.transactions.length;
            minedBlocks++;

            var difficulty = currentElement.header.getDifficulty();

            if (difficulty) {
                sumDifficulty += difficulty;
            }

            if (subsidy) {
                minedCurrencyAmount += subsidy;
            }

            if (fee) {
                allFee += fee;
            }

            if (outputAmount) {
                totalOutputsAmount += outputAmount;
            }

        } else {
            next = false;
        }

        height--;

    }

	var result = {
        n_blocks_mined: minedBlocks,
        time_between_blocks: sumBetweenTime && countBetweenTime ? sumBetweenTime / countBetweenTime : 0,
        mined_currency_amount: minedCurrencyAmount,
        transaction_fees: allFee,
        number_of_transactions: numTransactions,
        outputs_volume: totalOutputsAmount,
        difficulty: sumDifficulty,
        stake: minedCurrencyAmount && self.totalSubsidityAmount ? minedCurrencyAmount / self.totalSubsidityAmount : 0
    };

	return res.jsonp(result);
};

/**
 * helper to convert timestamps to yyyy-mm-dd format
 * @param {Date} date
 * @returns {string} yyyy-mm-dd format
 */
StatisticsController.prototype.formatTimestamp = function(date) {
	var yyyy = date.getUTCFullYear().toString();
	var mm = (date.getUTCMonth() + 1).toString(); // getMonth() is zero-based
	var dd = date.getUTCDate().toString();

	return yyyy + '-' + (mm[1] ? mm : '0' + mm[0]) + '-' + (dd[1] ? dd : '0' + dd[0]); //padding
};

StatisticsController.prototype._getLastBlocks = function(height, next) {

	var self = this,
    	blocks = [];

    for (var i = self.lastRequestedBlock + 1; i <= height; i++) {
        if (!self.knownBlocks.get(i)) {
            self.knownBlocks.set(i, true);
            blocks.push(i);
        }
    }

    self.lastRequestedBlock = height;

	return async.eachSeries(blocks, function (blockHeight, callback) {

		var dataFlow = {
            subsidy: null,
            block: null,
			fee: 0,
			totalOutputs: 0
		};

		return async.waterfall([function (callback) {

            /**
			 * Block
             */
            return self.node.getBlock(blockHeight, function(err, block) {

                if((err && err.code === -5) || (err && err.code === -8)) {
                    return callback(err);
                } else if(err) {
                    return callback(err);
                }

                dataFlow.block = block;

                return callback();

            });
		}, function (callback) {

            /**
			 * Subsidy
             */
            return self.node.getSubsidy(blockHeight, function(err, result) {
                dataFlow.subsidy = result;
                return callback();
			});

		}, function (callback) {

            /**
			 * Fee
             */

            if (dataFlow.block.header.fStake) { // IsProofOfStake

				var transaction1 = dataFlow.block.transactions[1],
					output1 = transaction1.outputs[1],
                    output2 = transaction1.outputs[2],
					input0 = transaction1.inputs[0],
                    prevTxId = input0.prevTxId,
                    outputIndex = input0.outputIndex,
					currentVoutsAmount = output1.satoshis;

				if (output2 && !output2.script.isPublicKeyHashOut()) {
                    currentVoutsAmount += output2.satoshis;
				}

				if (prevTxId) {
                    return self.node.getTransaction(prevTxId.toString('hex'), function (err, transaction) {
                    	if (err) {
                    		return callback(err);
						}

                        dataFlow.fee = currentVoutsAmount - transaction.outputs[outputIndex].satoshis;

                    	return callback();

					});
				} else {
                    return callback();
				}

			} else {//IsProofOfWork
                var transaction0 = dataFlow.block.transactions[0],
					output0 = transaction0.outputs[0];

                if ((output0.satoshis - dataFlow.subsidy) > 0) {
                	dataFlow.fee = output0.satoshis - dataFlow.subsidy;
				}

			}

            return callback();

		}, function (callback) {

            /**
			 * Total outputs
             */

			var trxsExcept = [];

            if (dataFlow.block.header.fStake) { // IsProofOfStake
                trxsExcept.push(0, 1);
            } else { //IsProofOfWork
                trxsExcept.push(0);
			}

            dataFlow.block.transactions.forEach(function (transaction, idx) {
                if (trxsExcept.indexOf(idx) === -1) {
                    transaction.outputs.forEach(function (output) {
						dataFlow.totalOutputs += output.satoshis;
                    });
				}
			});


            return callback();
		}], function (err) {

			if (err) {
				return callback(err);
			}

			var block = dataFlow.block,
                subsidy = dataFlow.subsidy,
                fee = dataFlow.fee,
                totalOutputs = dataFlow.totalOutputs,
                currentDate = new Date();

            currentDate.setDate(currentDate.getDate() - 1);

            var minTimestamp = currentDate.getTime() / 1000,
                maxAge = (block.header.time - minTimestamp) * 1000;

            self.totalSubsidityAmount += subsidy;

            if (maxAge > 0) {
            	self.blocksByHeight.set(blockHeight, block, maxAge);
                self.subsidyByBlockHeight.set(blockHeight, subsidy, maxAge);
                self.feeByHeight.set(blockHeight, fee, maxAge);
                self.outputsByHeight.set(blockHeight, totalOutputs, maxAge);
            }

            var date = new Date(block.header.time * 1000),
                formattedDate = self.formatTimestamp(date),
				cachedStatisticDay = self.statisticByDays.get(formattedDate);

            if (!cachedStatisticDay) {
                cachedStatisticDay = {
                    totalTransactionFees: {
                    	sum: 0,
						count: 0
					},
					numberOfTransactions: {
                    	count: 0
					},
					totalOutputVolume: {
                    	sum: 0
					},
					totalBlocks: {
                    	count: 0
					},
					difficulty: {
                    	sum: 0,
						count: 0
					},
					stake: {
                        sum: 0
					}
                };
			}

            cachedStatisticDay.totalTransactionFees.sum += fee;
            cachedStatisticDay.totalTransactionFees.count += 1;

            cachedStatisticDay.totalBlocks.count += 1;

            cachedStatisticDay.numberOfTransactions.count += block.transactions.length;

            cachedStatisticDay.totalOutputVolume.sum += totalOutputs;

            cachedStatisticDay.difficulty.sum += block.header.getDifficulty();
            cachedStatisticDay.difficulty.count += 1;
            cachedStatisticDay.stake.sum += subsidy;

            self.statisticByDays.set(formattedDate, cachedStatisticDay);

            return callback();
		});

	}, function (err) {

		if (err) {
            self.common.log.error('[STATISTICS] Update Error', err);
			return false;
		}

		if (height > self.lastCheckedBlock) {
            self.lastCheckedBlock = height;
        }

        return next();
	});

};

/**
 *
 * @param {number} height
 * @returns {boolean}
 * @private
 */
StatisticsController.prototype._rapidProtectedUpdateTip = function(height) {

	var self = this;

	this.lastTipHeight = height;

	if (this.lastTipInProcess) {
		return false;
	}

	this.lastTipInProcess = true;

    self.common.log.info('[STATISTICS] from ', self.lastCheckedBlock + 1 , ' to ', height);

    return this._getLastBlocks(height, function () {
        self.common.log.info('[STATISTICS] updated to ', height);
    	self.lastTipInProcess = false;

        if (self.lastTipHeight !== height) {
        	self._rapidProtectedUpdateTip(self.lastTipHeight);
		}

	});

};

module.exports = StatisticsController;