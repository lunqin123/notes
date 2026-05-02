import random


def main():
    target = random.randint(1, 100)
    attempts = 0

    print("猜数字游戏开始！我已经想好了一个 1 到 100 之间的数字。")

    while True:
        try:
            guess = int(input("请输入你猜的数字: "))
        except ValueError:
            print("请输入有效的整数！")
            continue

        attempts += 1

        if guess < 1 or guess > 100:
            print("请输入 1 到 100 之间的数字！")
        elif guess < target:
            print("太小了，再试试！")
        elif guess > target:
            print("太大了，再试试！")
        else:
            print(f"恭喜你，猜对了！答案就是 {target}，你用了 {attempts} 次猜中。")
            break


if __name__ == "__main__":
    main()
