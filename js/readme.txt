https://www.npmjs.com/package/canvas-confetti

https://www.kirilv.com/canvas-confetti/


//ex) 화면효과 > 종이 꽃가루 효과
function ShowEffectByStart() {
    confetti({
        particleCount: 200,
        startVelocity: 50,
        spread: 120,
        origin: { y: 0.5 }
      });
}