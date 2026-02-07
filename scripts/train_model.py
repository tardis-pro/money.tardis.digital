#!/usr/bin/env python3
import argparse
import csv
import json
import math
from pathlib import Path
from statistics import median


def parse_float(value):
    if value is None:
        return None
    text = str(value).strip()
    if text == "" or text.lower() in {"nan", "na", "null", "none"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def read_csv(path):
    with open(path, "r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return [row for row in reader]


def winsorize_with_mad(values, criterion=4.0):
    clean = [item for item in values if item is not None]
    if not clean:
        return values
    med = median(clean)
    deviations = [abs(item - med) for item in clean]
    mad = median(deviations) or 1e-9
    scale = 1.4826 * mad
    lower = med - criterion * scale
    upper = med + criterion * scale
    output = []
    for value in values:
        if value is None:
            output.append(None)
        else:
            output.append(min(upper, max(lower, value)))
    return output


def feature_columns(headers):
    blacklist = {
        "date_id",
        "forward_returns",
        "risk_free_rate",
        "market_forward_excess_returns",
        "lagged_forward_returns",
        "lagged_risk_free_rate",
        "lagged_market_forward_excess_returns",
        "is_scored",
    }
    return [column for column in headers if column not in blacklist]


def compute_feature_stats(rows, columns):
    stats = {}
    for column in columns:
        values = [parse_float(row.get(column)) for row in rows]
        clean = [item for item in values if item is not None]
        med = median(clean) if clean else 0.0
        mean = sum(clean) / len(clean) if clean else 0.0
        variance = (
            sum((item - mean) ** 2 for item in clean) / max(1, len(clean))
            if clean
            else 1.0
        )
        std = math.sqrt(variance) if variance > 0 else 1.0
        stats[column] = {
            "median": med,
            "mean": mean,
            "std": std,
        }
    return stats


def build_matrix(rows, columns, stats):
    matrix = []
    for row in rows:
        vector = [1.0]
        for column in columns:
            value = parse_float(row.get(column))
            missing = 1.0 if value is None else 0.0
            fill = stats[column]["median"] if value is None else value
            standardized = (fill - stats[column]["mean"]) / (
                stats[column]["std"] or 1.0
            )
            vector.append(standardized)
            vector.append(missing)
        matrix.append(vector)
    return matrix


def target_vector(rows, target_column):
    values = [parse_float(row.get(target_column)) for row in rows]
    return winsorize_with_mad(values, 4.0)


def temporal_split(rows, ratio=0.8):
    sorted_rows = sorted(rows, key=lambda row: int(row.get("date_id", "0") or "0"))
    split_index = int(len(sorted_rows) * ratio)
    return sorted_rows[:split_index], sorted_rows[split_index:]


def train_sgd(features, targets, epochs=40, learning_rate=0.01, l2=0.001):
    if not features:
        return []
    width = len(features[0])
    weights = [0.0] * width
    for _ in range(epochs):
        for index, row in enumerate(features):
            target = targets[index]
            if target is None:
                continue
            prediction = sum(weights[col] * row[col] for col in range(width))
            error = prediction - target
            for col in range(width):
                gradient = error * row[col] + l2 * weights[col]
                weights[col] -= learning_rate * gradient
    return weights


def evaluate(features, targets, weights):
    mse_sum = 0.0
    mae_sum = 0.0
    count = 0
    for index, row in enumerate(features):
        target = targets[index]
        if target is None:
            continue
        prediction = sum(weights[col] * row[col] for col in range(len(weights)))
        err = prediction - target
        mse_sum += err * err
        mae_sum += abs(err)
        count += 1
    if count == 0:
        return {"count": 0, "mse": 0.0, "rmse": 0.0, "mae": 0.0}
    mse = mse_sum / count
    return {
        "count": count,
        "mse": mse,
        "rmse": math.sqrt(mse),
        "mae": mae_sum / count,
    }


def predict(features, weights):
    output = []
    for row in features:
        output.append(sum(weights[col] * row[col] for col in range(len(weights))))
    return output


def main():
    parser = argparse.ArgumentParser(
        description="Train temporal model for market_forward_excess_returns"
    )
    parser.add_argument("--train", required=True)
    parser.add_argument("--test", required=False)
    parser.add_argument("--target", default="market_forward_excess_returns")
    parser.add_argument("--model-out", required=True)
    parser.add_argument("--predictions-out", required=False)
    args = parser.parse_args()

    train_rows = read_csv(args.train)
    if not train_rows:
        raise ValueError("Train CSV is empty")

    columns = feature_columns(list(train_rows[0].keys()))
    train_split, valid_split = temporal_split(train_rows, 0.8)
    stats = compute_feature_stats(train_split, columns)

    train_x = build_matrix(train_split, columns, stats)
    valid_x = build_matrix(valid_split, columns, stats)
    train_y = target_vector(train_split, args.target)
    valid_y = target_vector(valid_split, args.target)

    weights = train_sgd(train_x, train_y)
    train_metrics = evaluate(train_x, train_y, weights)
    valid_metrics = evaluate(valid_x, valid_y, weights)

    payload = {
        "target": args.target,
        "feature_columns": columns,
        "weights": weights,
        "feature_stats": stats,
        "metrics": {
            "train": train_metrics,
            "validation": valid_metrics,
        },
        "training_rows": len(train_rows),
        "temporal_split_ratio": 0.8,
    }

    model_out = Path(args.model_out)
    model_out.parent.mkdir(parents=True, exist_ok=True)
    model_out.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    if args.test and args.predictions_out:
        test_rows = read_csv(args.test)
        test_x = build_matrix(test_rows, columns, stats)
        test_pred = predict(test_x, weights)

        predictions_out = Path(args.predictions_out)
        predictions_out.parent.mkdir(parents=True, exist_ok=True)
        with predictions_out.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["date_id", "prediction", "is_scored"])
            for idx, row in enumerate(test_rows):
                writer.writerow(
                    [
                        row.get("date_id", ""),
                        test_pred[idx],
                        row.get("is_scored", ""),
                    ]
                )

    print(json.dumps(payload["metrics"], indent=2))


if __name__ == "__main__":
    main()
