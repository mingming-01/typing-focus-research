import glob
import os

import pandas as pd
import matplotlib.pyplot as plt


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RAW_DIR = os.path.join(BASE_DIR, "data", "raw")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")


def load_data():
    """실험 결과 CSV 파일을 모두 읽는다."""
    pattern = os.path.join(RAW_DIR, "typing_results_*.csv")
    files = sorted(glob.glob(pattern))

    if not files:
        raise FileNotFoundError(
            f"CSV 파일을 찾을 수 없습니다: {pattern}"
        )

    dataframes = []

    for file in files:
        df = pd.read_csv(file)

        # 어떤 파일에서 나온 데이터인지 기록
        df["source_file"] = os.path.basename(file)

        dataframes.append(df)

    data = pd.concat(dataframes, ignore_index=True)

    return data


def validate_data(data):
    """분석에 필요한 데이터가 정상인지 확인한다."""
    required_columns = [
        "trial",
        "condition",
        "sentence_id",
        "sentence",
        "typed_text",
        "typing_speed",
        "accuracy",
        "elapsed_seconds",
    ]

    missing_columns = [
        column
        for column in required_columns
        if column not in data.columns
    ]

    if missing_columns:
        raise ValueError(
            f"필수 컬럼이 없습니다: {missing_columns}"
        )

    data["typing_speed"] = pd.to_numeric(
        data["typing_speed"],
        errors="coerce"
    )

    data["accuracy"] = pd.to_numeric(
        data["accuracy"],
        errors="coerce"
    )

    data["elapsed_seconds"] = pd.to_numeric(
        data["elapsed_seconds"],
        errors="coerce"
    )

    data["condition"] = (
        data["condition"]
        .astype(str)
        .str.upper()
        .str.strip()
    )

    data = data.dropna(
        subset=[
            "condition",
            "typing_speed",
            "accuracy",
            "elapsed_seconds",
        ]
    )

    invalid_conditions = set(data["condition"]) - {"ON", "OFF"}

    if invalid_conditions:
        raise ValueError(
            f"잘못된 condition 값이 있습니다: {invalid_conditions}"
        )

    return data


def make_summary(data):
    """시각적 효과 ON/OFF 조건별 기술통계를 계산한다."""
    summary = (
        data.groupby("condition")
        .agg(
            count=("typing_speed", "count"),

            speed_mean=("typing_speed", "mean"),
            speed_median=("typing_speed", "median"),
            speed_std=("typing_speed", "std"),
            speed_min=("typing_speed", "min"),
            speed_max=("typing_speed", "max"),

            accuracy_mean=("accuracy", "mean"),
            accuracy_median=("accuracy", "median"),
            accuracy_std=("accuracy", "std"),

            elapsed_mean=("elapsed_seconds", "mean"),
            elapsed_median=("elapsed_seconds", "median"),
            elapsed_std=("elapsed_seconds", "std"),
        )
        .reset_index()
    )

    return summary


def make_comparison(summary):
    """ON/OFF 조건의 평균 차이와 변화율을 계산한다."""
    summary_by_condition = summary.set_index("condition")

    if "ON" not in summary_by_condition.index:
        return pd.DataFrame()

    if "OFF" not in summary_by_condition.index:
        return pd.DataFrame()

    metrics = [
        ("typing_speed", "speed_mean"),
        ("accuracy", "accuracy_mean"),
        ("elapsed_seconds", "elapsed_mean"),
    ]

    rows = []

    for metric_name, column_name in metrics:
        off_value = summary_by_condition.loc[
            "OFF",
            column_name
        ]

        on_value = summary_by_condition.loc[
            "ON",
            column_name
        ]

        difference = on_value - off_value

        if off_value != 0:
            change_percent = difference / off_value * 100
        else:
            change_percent = None

        rows.append(
            {
                "metric": metric_name,
                "off_mean": off_value,
                "on_mean": on_value,
                "difference_on_minus_off": difference,
                "change_percent": change_percent,
            }
        )

    return pd.DataFrame(rows)


def make_common_sentence_comparison(data):
    """
    ON과 OFF가 모두 존재하는 문장만 골라
    문장별 타이핑 속도를 비교한다.
    """

    sentence_condition = (
        data.groupby(
            ["sentence_id", "condition"]
        )["typing_speed"]
        .mean()
        .unstack()
    )

    if "ON" not in sentence_condition.columns:
        return pd.DataFrame()

    if "OFF" not in sentence_condition.columns:
        return pd.DataFrame()

    common = sentence_condition.dropna(
        subset=["OFF", "ON"]
    ).copy()

    common["difference_on_minus_off"] = (
        common["ON"] - common["OFF"]
    )

    common["change_percent"] = (
        common["difference_on_minus_off"]
        / common["OFF"]
        * 100
    )

    common = common.reset_index()

    common = common.rename(
        columns={
            "OFF": "off_speed",
            "ON": "on_speed",
        }
    )

    return common


def save_csv(data, filename):
    """분석 결과를 CSV로 저장한다."""
    output_file = os.path.join(
        OUTPUT_DIR,
        filename
    )

    data.to_csv(
        output_file,
        index=False,
        encoding="utf-8-sig"
    )

    return output_file


def make_graph(
    data,
    column,
    title,
    ylabel,
    filename
):
    """ON/OFF 조건별 평균을 그래프로 저장한다."""
    grouped = (
        data.groupby("condition")[column]
        .mean()
        .reindex(["OFF", "ON"])
    )

    plt.figure(figsize=(7, 5))

    grouped.plot(kind="bar")

    plt.title(title)
    plt.xlabel("Visual Effect")
    plt.ylabel(ylabel)
    plt.xticks(rotation=0)

    plt.tight_layout()

    output_file = os.path.join(
        OUTPUT_DIR,
        filename
    )

    plt.savefig(
        output_file,
        dpi=150
    )

    plt.close()

    return output_file


def main():
    os.makedirs(
        OUTPUT_DIR,
        exist_ok=True
    )

    print("=== 시각적 효과 타이핑 실험 분석 시작 ===")

    # 1. 데이터 불러오기
    data = load_data()

    print(
        f"읽은 실험 파일 수: "
        f"{data['source_file'].nunique()}"
    )

    print(
        f"전체 실험 횟수: {len(data)}"
    )

    # 2. 데이터 검증
    data = validate_data(data)

    # 3. 조건별 실험 횟수
    print()
    print("=== 시각적 효과 조건별 실험 횟수 ===")
    print(
        data["condition"]
        .value_counts()
        .sort_index()
    )

    # 4. 전체 원자료 저장
    combined_file = save_csv(
        data,
        "combined_typing_results.csv"
    )

    # 5. 조건별 기술통계
    summary = make_summary(data)

    summary_file = save_csv(
        summary,
        "summary.csv"
    )

    # 6. ON/OFF 평균 비교
    comparison = make_comparison(summary)

    comparison_file = save_csv(
        comparison,
        "condition_comparison.csv"
    )

    # 7. 동일 문장 비교
    common_sentence = make_common_sentence_comparison(
        data
    )

    common_sentence_file = save_csv(
        common_sentence,
        "common_sentence_comparison.csv"
    )

    # 8. 그래프
    speed_graph = make_graph(
        data,
        "typing_speed",
        "Typing Speed: Visual Effect ON vs OFF",
        "Typing Speed",
        "typing_speed_comparison.png",
    )

    accuracy_graph = make_graph(
        data,
        "accuracy",
        "Accuracy: Visual Effect ON vs OFF",
        "Accuracy (%)",
        "accuracy_comparison.png",
    )

    elapsed_graph = make_graph(
        data,
        "elapsed_seconds",
        "Elapsed Time: Visual Effect ON vs OFF",
        "Elapsed Time (seconds)",
        "elapsed_time_comparison.png",
    )

    # 9. 결과 출력
    print()
    print("=== 조건별 기술통계 ===")
    print(
        summary.to_string(
            index=False
        )
    )

    print()
    print("=== ON/OFF 평균 차이 ===")
    print(
        comparison.to_string(
            index=False
        )
    )

    print()
    print("=== 동일 문장 비교 ===")

    if common_sentence.empty:
        print(
            "ON과 OFF가 모두 존재하는 "
            "문장이 없습니다."
        )
    else:
        print(
            common_sentence.to_string(
                index=False
            )
        )

    # 10. 생성 파일 출력
    print()
    print("=== 생성된 결과 ===")

    print(combined_file)
    print(summary_file)
    print(comparison_file)
    print(common_sentence_file)

    print(speed_graph)
    print(accuracy_graph)
    print(elapsed_graph)

    print()
    print("=== 분석 완료 ===")


if __name__ == "__main__":
    main()